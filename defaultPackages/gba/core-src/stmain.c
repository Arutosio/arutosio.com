/* aruta.sh GBA Link core — single-threaded mGBA WASM wrapper with SIO→JS hooks.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Replaces the fork's pthread-based main.c: no mCoreThread, no SDL.
 * JS drives emulation by calling runFrame() from requestAnimationFrame,
 * reads the video buffer from the heap, pulls audio via readAudio(), and
 * bridges multiplayer serial transfers through the netDriver hooks below.
 *
 * SIO model (GBA MULTI mode, 2 players):
 *  - master (id 0) game sets SIOCNT Start → driver keeps Busy high and
 *    fires Module.onSioStart(localSIOMLT_SEND). JS must NOT re-enter the
 *    wasm synchronously from that callback — queue and complete later.
 *  - JS exchanges the two SIOMLT_SEND values between peers, then calls
 *    sioCompleteMulti(d0, d1) on BOTH instances: writes SIOMULTI0/1,
 *    clears Busy, sets the player Id and raises the SIO IRQ if enabled.
 *  - slave (id 1) never initiates; JS asks it for sioGetSendValue() when
 *    the master's transfer request arrives.
 */
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/io.h>
#include <mgba/internal/gba/sio.h>
#include <mgba/internal/gba/savedata.h>
/* Game Boy / Game Boy Color link support (2-player byte serial). */
#include <mgba/internal/gb/gb.h>
#include <mgba/internal/gb/io.h>
#include <mgba/internal/gb/sio.h>
#include <mgba/gb/interface.h>
#include <mgba-util/audio-buffer.h>
#include <mgba-util/vfs.h>

#include <emscripten.h>

/* Which serial bridge the loaded ROM uses. */
#define LINK_PLATFORM_GBA 0
#define LINK_PLATFORM_GB  1
static int linkPlatform = LINK_PLATFORM_GBA;

EMSCRIPTEN_KEEPALIVE int getLinkPlatform(void) {
	return linkPlatform;
}

static void _nullLog(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	UNUSED(logger);
	UNUSED(category);
	UNUSED(level);
	UNUSED(format);
	UNUSED(args);
}
static struct mLogger logCtx = { .log = _nullLog };

static struct mCore* core = NULL;
static mColor* videoBuffer = NULL;
static unsigned videoW = 240;
static unsigned videoH = 160;

/* ───────────────────────────── SIO net driver ───────────────────────────── */

struct GBASIONetDriver {
	struct GBASIODriver d;
	int id;              /* 0 = master, 1..3 = slaves */
	int playerCount;     /* connected players including self (set from JS) */
	bool connected;      /* ≥2 players attached */
	bool transferPending; /* master only: waiting for peer replies */
};

static struct GBASIONetDriver netDriver;

static void _updateStatusBits(struct GBASIO* sio) {
	sio->siocnt = GBASIOMultiplayerSetSlave(sio->siocnt, netDriver.id > 0);
	sio->siocnt = GBASIOMultiplayerSetReady(sio->siocnt, netDriver.connected);
	if (netDriver.id) {
		sio->rcnt |= 4;
	} else {
		sio->rcnt &= ~4;
	}
}

static bool netInit(struct GBASIODriver* driver) {
	UNUSED(driver);
	return true;
}

static void netDeinit(struct GBASIODriver* driver) {
	UNUSED(driver);
}

static bool netLoad(struct GBASIODriver* driver) {
	netDriver.transferPending = false;
	_updateStatusBits(driver->p);
	return true;
}

static bool netUnload(struct GBASIODriver* driver) {
	UNUSED(driver);
	netDriver.transferPending = false;
	return true;
}

static uint16_t netWriteRegister(struct GBASIODriver* driver, uint32_t address, uint16_t value) {
	struct GBASIO* sio = driver->p;
	if (address == GBA_REG_SIOCNT) {
		/* Writable bits only; status bits (Ready/Slave/Id/Error) are ours. */
		value &= 0xFF83;
		value |= sio->siocnt & 0x00FC;
		value = GBASIOMultiplayerSetSlave(value, netDriver.id > 0);
		value = GBASIOMultiplayerSetReady(value, netDriver.connected);

		if ((value & 0x0080) && !netDriver.id && netDriver.connected && !netDriver.transferPending) {
			/* Master starts a transfer: latch Busy, hand our send value to JS,
			 * and break out of the current runLoop slice so JS can wait for
			 * the peer's value with the emulated clock frozen mid-frame
			 * (Emerald clocks 9 transfers per frame off Timer3 and raises a
			 * lag error if a vblank arrives early — same earlyExit trick as
			 * mGBA's own lockstep driver). */
			netDriver.transferPending = true;
			struct GBA* gba = sio->p;
			uint16_t send = gba->memory.io[GBA_REG(SIOMLT_SEND)];
			gba->memory.io[GBA_REG(SIOMULTI0)] = 0xFFFF;
			gba->memory.io[GBA_REG(SIOMULTI1)] = 0xFFFF;
			gba->memory.io[GBA_REG(SIOMULTI2)] = 0xFFFF;
			gba->memory.io[GBA_REG(SIOMULTI3)] = 0xFFFF;
			sio->rcnt &= ~1;
			gba->earlyExit = true;
			EM_ASM({
				if (Module.onSioStart) Module.onSioStart($0);
			}, send);
		}
		if (netDriver.transferPending) {
			value |= 0x0080;
		} else if (netDriver.id) {
			/* Slaves cannot hold Busy via their own writes. */
			value &= ~0x0080;
		}
	}
	return value;
}

/* Set local player id (0 = master, 1..3 = slave slot) and the number of
 * connected players including self. count >= 2 means "cable attached". */
EMSCRIPTEN_KEEPALIVE void sioSetLink(int id, int count) {
	netDriver.id = id & 3;
	netDriver.playerCount = count;
	netDriver.connected = count >= 2;
	if (core && netDriver.d.p) {
		_updateStatusBits(netDriver.d.p);
	}
}

/* Current SIOMLT_SEND — what this GBA would put on the wire. */
EMSCRIPTEN_KEEPALIVE int sioGetSendValue(void) {
	if (!core || linkPlatform != LINK_PLATFORM_GBA) {
		return 0xFFFF;
	}
	struct GBA* gba = (struct GBA*) core->board;
	return gba->memory.io[GBA_REG(SIOMLT_SEND)];
}

/* True while the master is stalled waiting for the peer's value. */
EMSCRIPTEN_KEEPALIVE int sioTransferPending(void) {
	return netDriver.transferPending;
}

static int sioIrqCount = 0;
static int sioCompleteCount = 0;

/* Ring log of completed transfer pairs for divergence debugging. */
#define SIO_LOG_LEN 256
static uint32_t sioLog[SIO_LOG_LEN];
static int sioLogPos = 0;

/* Complete a MULTI transfer on this instance with every player's value
 * (absent slots = 0xFFFF). Call between frames (never synchronously from
 * inside onSioStart). */
EMSCRIPTEN_KEEPALIVE void sioCompleteMulti4(int d0, int d1, int d2, int d3) {
	if (!core) {
		return;
	}
	struct GBA* gba = (struct GBA*) core->board;
	struct GBASIO* sio = &gba->sio;
	gba->memory.io[GBA_REG(SIOMULTI0)] = d0 & 0xFFFF;
	gba->memory.io[GBA_REG(SIOMULTI1)] = d1 & 0xFFFF;
	gba->memory.io[GBA_REG(SIOMULTI2)] = d2 & 0xFFFF;
	gba->memory.io[GBA_REG(SIOMULTI3)] = d3 & 0xFFFF;
	sio->rcnt |= 1;
	sio->siocnt = GBASIOMultiplayerClearBusy(sio->siocnt);
	sio->siocnt = GBASIOMultiplayerSetId(sio->siocnt, netDriver.id);
	netDriver.transferPending = false;
	++sioCompleteCount;
	sioLog[sioLogPos % SIO_LOG_LEN] = ((d0 & 0xFFFF) << 16) | (d1 & 0xFFFF);
	++sioLogPos;
	if (GBASIOMultiplayerIsIrq(sio->siocnt)) {
		++sioIrqCount;
		GBARaiseIRQ(gba, GBA_IRQ_SIO, 0);
	}
}

EMSCRIPTEN_KEEPALIVE void sioCompleteMulti(int d0, int d1) {
	sioCompleteMulti4(d0, d1, 0xFFFF, 0xFFFF);
}

EMSCRIPTEN_KEEPALIVE int sioLogCount(void) {
	return sioLogPos;
}

EMSCRIPTEN_KEEPALIVE int sioLogGet(int i) {
	return sioLog[i % SIO_LOG_LEN];
}

/* ── slave-side transfer queue ──
 * The master bursts up to 9 transfers per frame (Pokémon clocks them off
 * Timer3) and the network delivers them back-to-back in one JS turn. The
 * serial IF bit is a single flag: completing them all at once collapses 9
 * IRQs into 1 and the game's ISR misses 8 transfers. Instead JS pushes
 * master values here and an mTiming event completes them one at a time,
 * waiting for the previous serial IRQ to be serviced first, with emulated
 * CPU time in between — exactly like a real cable. */
#define SIO_QUEUE_LEN 64
static struct {
	uint16_t d[4];
} sioQueue[SIO_QUEUE_LEN];
static int sioQHead = 0;
static int sioQCount = 0;
static struct mTimingEvent sioSlaveEvent;

static bool sioDrainArmed = false;

static void _sioSlaveDrain(struct mTiming* timing, void* context, uint32_t cyclesLate) {
	UNUSED(context);
	UNUSED(cyclesLate);
	if (!core || !sioQCount) {
		sioDrainArmed = false;
		return;
	}
	struct GBA* gba = (struct GBA*) core->board;
	if (gba->memory.io[GBA_REG(IF)] & (1 << GBA_IRQ_SIO)) {
		/* Previous serial IRQ not yet serviced — let the CPU breathe. */
		sioDrainArmed = false;
		mTimingSchedule(timing, &sioSlaveEvent, 2048);
		return;
	}
	if (!sioDrainArmed) {
		/* Two-phase delivery: IF clears at IntrMain ENTRY, but SerialCB
		 * reads the SIOMULTI registers a few hundred cycles later.
		 * Completing the next transfer inside that window overwrites the
		 * registers before the handler reads them — the game then loses a
		 * halfword and its packet checksum fails ("link error"). Seeing IF
		 * clear only ARMS the delivery; the write happens one grace period
		 * later, when the previous handler is guaranteed done. */
		sioDrainArmed = true;
		mTimingSchedule(timing, &sioSlaveEvent, 4096);
		return;
	}
	sioDrainArmed = false;
	uint16_t* d = sioQueue[sioQHead].d;
	int d0 = d[0];
	int d1 = d[1];
	int d2 = d[2];
	int d3 = d[3];
	sioQHead = (sioQHead + 1) % SIO_QUEUE_LEN;
	--sioQCount;
	sioCompleteMulti4(d0, d1, d2, d3);
	if (sioQCount) {
		/* Pace at the real Timer3 cadence (197*64 cycles). */
		mTimingSchedule(timing, &sioSlaveEvent, 12608);
	}
}

/* Queue a finished transfer's full value vector on a slave; drained with
 * emulated time between completions so every transfer gets its own serial
 * IRQ. The slave's reply for the NEXT transfer is read by JS (after this
 * queue is empty) via sioGetSendValue(). */
EMSCRIPTEN_KEEPALIVE void sioPushCompletion(int d0, int d1, int d2, int d3) {
	if (!core || sioQCount >= SIO_QUEUE_LEN) {
		return;
	}
	int tail = (sioQHead + sioQCount) % SIO_QUEUE_LEN;
	sioQueue[tail].d[0] = d0 & 0xFFFF;
	sioQueue[tail].d[1] = d1 & 0xFFFF;
	sioQueue[tail].d[2] = d2 & 0xFFFF;
	sioQueue[tail].d[3] = d3 & 0xFFFF;
	++sioQCount;
	struct GBA* gba = (struct GBA*) core->board;
	if (!mTimingIsScheduled(&gba->timing, &sioSlaveEvent)) {
		mTimingSchedule(&gba->timing, &sioSlaveEvent, 512);
	}
}

EMSCRIPTEN_KEEPALIVE int sioQueueCount(void) {
	return sioQCount;
}

/* Debug snapshot of the serial state — JS packs these into an object. */
EMSCRIPTEN_KEEPALIVE int sioGetSiocnt(void) {
	if (!core || linkPlatform != LINK_PLATFORM_GBA) {
		return -1;
	}
	struct GBA* gba = (struct GBA*) core->board;
	return gba->sio.siocnt;
}

EMSCRIPTEN_KEEPALIVE int sioGetRcnt(void) {
	if (!core || linkPlatform != LINK_PLATFORM_GBA) {
		return -1;
	}
	struct GBA* gba = (struct GBA*) core->board;
	return gba->sio.rcnt;
}

EMSCRIPTEN_KEEPALIVE int sioGetMode(void) {
	if (!core || linkPlatform != LINK_PLATFORM_GBA) {
		return -1;
	}
	struct GBA* gba = (struct GBA*) core->board;
	return gba->sio.mode;
}

EMSCRIPTEN_KEEPALIVE int sioGetIrqCount(void) {
	return sioIrqCount;
}

/* Raw bus reads for protocol debugging (IE/IME, game link state, …). */
EMSCRIPTEN_KEEPALIVE int readBus16(int address) {
	if (!core) {
		return -1;
	}
	return core->busRead16(core, (uint32_t) address);
}

EMSCRIPTEN_KEEPALIVE int readBus8(int address) {
	if (!core) {
		return -1;
	}
	return core->busRead8(core, (uint32_t) address);
}

EMSCRIPTEN_KEEPALIVE int sioGetCompleteCount(void) {
	return sioCompleteCount;
}

/* ─────────────────────── GB/GBC serial bridge (2 players) ───────────────────────
 * Game Boy link is an 8-bit byte exchange: one side drives the clock (SC
 * internal-clock bit set), the other is passive (external clock). Stock
 * mGBA's GB SIO only self-drives the active side and shifts in 0xFF (no
 * peer). We install a GBSIODriver that, on the active side, captures the
 * outgoing byte and freezes emulated time until JS brings the peer's byte;
 * on the passive side JS drives completion when the clocking peer's byte
 * arrives over the network. Either side may be the clocker (the game picks
 * during the link handshake), so the JS layer is symmetric, not host-drives. */

struct GBSIONetDriver {
	struct GBSIODriver d;
	bool pending;     /* a byte transfer is waiting on the network */
	bool active;      /* this side drove the clock (fired onGbSioStart) */
	uint8_t outByte;  /* the byte this side put on the wire */
};
static struct GBSIONetDriver gbNet;

static bool gbNetInit(struct GBSIODriver* driver) { UNUSED(driver); return true; }
static void gbNetDeinit(struct GBSIODriver* driver) { UNUSED(driver); }

static void gbNetWriteSB(struct GBSIODriver* driver, uint8_t value) {
	/* The CPU write already stored `value` into io[GB_REG_SB]. */
	UNUSED(driver);
	UNUSED(value);
}

static uint8_t gbNetWriteSC(struct GBSIODriver* driver, uint8_t value) {
	struct GBSIO* sio = driver->p;
	struct GB* gb = sio->p;
	if (value & 0x80) { /* transfer enable */
		uint8_t out = gb->memory.io[GB_REG_SB];
		gbNet.outByte = out;
		gbNet.pending = true;
		if (value & 0x01) {
			/* Internal clock: this side clocks the transfer. Stop stock
			 * mGBA from completing it with 0xFF, freeze time, hand the
			 * byte to JS. */
			gbNet.active = true;
			mTimingDeschedule(&gb->timing, &sio->event);
			sio->remainingBits = 0;
			gb->earlyExit = true;
			EM_ASM({
				if (Module.onGbSioStart) Module.onGbSioStart($0);
			}, out);
		} else {
			/* External clock: passive. Wait for the clocking peer's byte
			 * (JS calls gbSioCompleteByte). */
			gbNet.active = false;
		}
	}
	return value;
}

/* Current outgoing byte (what this GB would put on the wire). */
EMSCRIPTEN_KEEPALIVE int gbSioGetSendByte(void) {
	if (!core) {
		return 0xFF;
	}
	struct GB* gb = (struct GB*) core->board;
	return gb->memory.io[GB_REG_SB];
}

EMSCRIPTEN_KEEPALIVE int gbSioPending(void) {
	return gbNet.pending;
}

/* Complete a byte transfer with the peer's byte: load it into SB, clear the
 * SC enable bit, raise the serial IRQ. Drives BOTH the active side (on the
 * peer's reply) and the passive side (on the clocker's byte). */
EMSCRIPTEN_KEEPALIVE void gbSioCompleteByte(int incoming) {
	if (!core) {
		return;
	}
	struct GB* gb = (struct GB*) core->board;
	struct GBSIO* sio = &gb->sio;
	mTimingDeschedule(&gb->timing, &sio->event);
	sio->remainingBits = 0;
	gb->memory.io[GB_REG_SB] = incoming & 0xFF;
	gb->memory.io[GB_REG_SC] &= ~0x80; /* clear transfer-enable */
	gb->memory.io[GB_REG_IF] |= (1 << GB_IRQ_SIO);
	GBUpdateIRQs(gb);
	gbNet.pending = false;
	++sioCompleteCount;
	sioLog[sioLogPos % SIO_LOG_LEN] = ((gbNet.outByte & 0xFF) << 16) | (incoming & 0xFF);
	++sioLogPos;
}

/* ───────────────────────────── core lifecycle ───────────────────────────── */

EMSCRIPTEN_KEEPALIVE void quitGame(void) {
	if (!core) {
		return;
	}
	core->unloadROM(core);
	mCoreConfigDeinit(&core->config);
	core->deinit(core);
	core = NULL;
	if (videoBuffer) {
		free(videoBuffer);
		videoBuffer = NULL;
	}
}

EMSCRIPTEN_KEEPALIVE bool loadGame(const char* path) {
	quitGame();
	mLogSetDefaultLogger(&logCtx);

	core = mCoreFind(path);
	if (!core) {
		return false;
	}
	core->init(core);
	core->opts.savegamePath = strdup("/data/saves");
	core->opts.savestatePath = strdup("/data/states");

	mCoreConfigInit(&core->config, "wasm-st");
	struct mCoreOptions defaultOpts = {
		.useBios = true,
		.volume = 0x100,
		.logLevel = 0,
	};
	mCoreConfigLoadDefaults(&core->config, &defaultOpts);
	mCoreLoadConfig(core);

	if (!mCoreLoadFile(core, path)) {
		core->deinit(core);
		core = NULL;
		return false;
	}
	mDirectorySetMapOptions(&core->dirs, &core->opts);
	mCoreAutoloadSave(core);

	linkPlatform = (core->platform(core) == mPLATFORM_GB)
		? LINK_PLATFORM_GB : LINK_PLATFORM_GBA;

	/* The GBA BIOS only applies to GBA; loading it into a GB core would be
	 * wrong (GB has its own boot ROM, handled internally / skipped). */
	if (linkPlatform == LINK_PLATFORM_GBA) {
		struct VFile* bios = VFileOpen("/gba_bios.bin", O_RDONLY);
		if (bios) {
			core->loadBIOS(core, bios, 0);
		}
	}

	core->baseVideoSize(core, &videoW, &videoH);
	videoBuffer = malloc(videoW * videoH * BYTES_PER_PIXEL);
	core->setVideoBuffer(core, videoBuffer, videoW);
	core->setAudioBufferSize(core, 2048);

	if (linkPlatform == LINK_PLATFORM_GB) {
		gbNet.d.init = gbNetInit;
		gbNet.d.deinit = gbNetDeinit;
		gbNet.d.writeSB = gbNetWriteSB;
		gbNet.d.writeSC = gbNetWriteSC;
		gbNet.pending = false;
		gbNet.active = false;
		struct GB* gb = (struct GB*) core->board;
		GBSIOSetDriver(&gb->sio, &gbNet.d);
	} else {
		netDriver.d.init = netInit;
		netDriver.d.deinit = netDeinit;
		netDriver.d.load = netLoad;
		netDriver.d.unload = netUnload;
		netDriver.d.writeRegister = netWriteRegister;
		netDriver.transferPending = false;
		sioQHead = 0;
		sioQCount = 0;
		sioSlaveEvent.name = "GBA SIO net slave";
		sioSlaveEvent.callback = _sioSlaveDrain;
		sioSlaveEvent.context = NULL;
		sioSlaveEvent.priority = 0x80;
		struct GBA* gba = (struct GBA*) core->board;
		GBASIOSetDriver(&gba->sio, &netDriver.d, GBA_SIO_MULTI);
	}

	core->reset(core);
	return true;
}

EMSCRIPTEN_KEEPALIVE void runFrame(void) {
	if (core) {
		core->runFrame(core);
	}
}

/* Run until frame end OR until the SIO driver requests an early exit
 * (transfer waiting on the network). Pair with frameCount() to detect
 * whether the frame actually completed. */
EMSCRIPTEN_KEEPALIVE void runLoop(void) {
	if (core) {
		core->runLoop(core);
	}
}

/* Run for ~n emulated cycles, not a full frame: lets the slave drain its
 * transfer queue at sub-frame granularity, so a burst of master transfers
 * doesn't make the slave's game clock race ahead of the master's. */
static struct mTimingEvent sioBreakEvent;
static bool sioBreakHit = false;
static void _sioBreak(struct mTiming* timing, void* context, uint32_t cyclesLate) {
	UNUSED(timing);
	UNUSED(context);
	UNUSED(cyclesLate);
	sioBreakHit = true;
	if (core) {
		((struct GBA*) core->board)->earlyExit = true;
	}
}

EMSCRIPTEN_KEEPALIVE void runCycles(int n) {
	if (!core) {
		return;
	}
	struct GBA* gba = (struct GBA*) core->board;
	sioBreakEvent.name = "GBA SIO net break";
	sioBreakEvent.callback = _sioBreak;
	sioBreakEvent.context = NULL;
	sioBreakEvent.priority = 0x70;
	if (mTimingIsScheduled(&gba->timing, &sioBreakEvent)) {
		mTimingDeschedule(&gba->timing, &sioBreakEvent);
	}
	mTimingSchedule(&gba->timing, &sioBreakEvent, n > 0 ? n : 1);
	/* core->runLoop returns at EVERY timing-event batch (ARMRunLoop steps to
	 * the next event, processes it, returns) — a single call runs ~one HBlank
	 * of emulated time, not n cycles. Loop until the break event fires, or
	 * the queue drains and the ISR work this slice exists for never happens:
	 * the slave then replies with the PREVIOUS transfer's halfword and the
	 * games' link protocol shifts by one slot (checksum errors, lost
	 * commands, LAG_SLAVE). */
	sioBreakHit = false;
	int guard = 100000;
	while (!sioBreakHit && guard--) {
		core->runLoop(core);
	}
	if (mTimingIsScheduled(&gba->timing, &sioBreakEvent)) {
		mTimingDeschedule(&gba->timing, &sioBreakEvent);
	}
}

EMSCRIPTEN_KEEPALIVE int frameCount(void) {
	if (!core) {
		return -1;
	}
	return core->frameCounter(core);
}

EMSCRIPTEN_KEEPALIVE void setKeys(int keys) {
	if (core) {
		core->setKeys(core, keys);
	}
}

/* ───────────────────────────── video / audio ───────────────────────────── */

EMSCRIPTEN_KEEPALIVE int getVideoBufferPtr(void) {
	return (int) (intptr_t) videoBuffer;
}

EMSCRIPTEN_KEEPALIVE int getVideoWidth(void) {
	return videoW;
}

EMSCRIPTEN_KEEPALIVE int getVideoHeight(void) {
	return videoH;
}

/* Pull up to `count` interleaved stereo frames into `out`; returns frames read.
 * Core output rate is 32768 Hz. */
EMSCRIPTEN_KEEPALIVE int readAudio(int16_t* out, int count) {
	if (!core) {
		return 0;
	}
	struct mAudioBuffer* buf = core->getAudioBuffer(core);
	if (!buf) {
		return 0;
	}
	return mAudioBufferRead(buf, out, count);
}

/* ───────────────────────────── saves / states ───────────────────────────── */

/* Force SRAM out to the FS file mapped by mCoreAutoloadSave so JS can read
 * /data/saves/<name>.sav without waiting for the savedata dirty timer. */
EMSCRIPTEN_KEEPALIVE void flushSave(void) {
	if (!core) {
		return;
	}
	struct GBA* gba = (struct GBA*) core->board;
	struct GBASavedata* savedata = &gba->memory.savedata;
	if (savedata->vf && savedata->data) {
		savedata->vf->sync(savedata->vf, savedata->data, GBASavedataSize(savedata));
	}
}

EMSCRIPTEN_KEEPALIVE bool saveState(int slot) {
	if (!core) {
		return false;
	}
	return mCoreSaveState(core, slot, SAVESTATE_SAVEDATA | SAVESTATE_RTC | SAVESTATE_METADATA);
}

EMSCRIPTEN_KEEPALIVE bool loadState(int slot) {
	if (!core) {
		return false;
	}
	return mCoreLoadState(core, slot, SAVESTATE_SAVEDATA | SAVESTATE_RTC);
}
