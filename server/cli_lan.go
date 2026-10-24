package main

import (
	"encoding/json"
	"fmt"
	"os"
)

func firewallManual(st firewallState, port int) string {
	rule := fmt.Sprintf("%d/tcp", port)
	switch st.Backend {
	case "ufw":
		return "sudo ufw allow " + rule
	case "firewalld":
		return "sudo firewall-cmd --permanent --add-port=" + rule + " && sudo firewall-cmd --reload"
	case "nftables", "iptables":
		return "open " + rule + " with " + st.Backend
	default:
		return fmt.Sprintf("open %d/tcp in your firewall or router", port)
	}
}

func firewallCloseManual(rec firewallRecord) string {
	switch rec.Backend {
	case "ufw":
		return "sudo ufw delete allow " + rec.Rule
	case "firewalld":
		return "sudo firewall-cmd --permanent --remove-port=" + rec.Rule + " && sudo firewall-cmd --reload"
	default:
		return "close " + rec.Rule + " with " + rec.Backend
	}
}

func lanURLs(port int) []string {
	var out []string
	for _, ip := range lanIPs() {
		out = append(out, fmt.Sprintf("http://%s:%d/", ip, port))
	}
	return out
}

func cmdLan(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: arutosiod lan on|off|status [options]")
		return 2
	}
	action := args[0]
	fs := newSet("lan " + action)
	data := addDataFlag(fs)
	yes := fs.Bool("yes", false, "do not ask for confirmation")
	noFirewall := fs.Bool("no-firewall", false, "do not touch the firewall")
	asJSON := fs.Bool("json", false, "machine-readable output")
	_ = fs.Parse(args[1:])

	cfg, _, err := loadConfig(*data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
		return 1
	}
	port := listenPort(cfg.Listen)

	switch action {
	case "status":
		st, code := buildStatus(*data)
		if *asJSON {
			raw, _ := json.MarshalIndent(map[string]any{
				"listen":   st.Listen,
				"lan":      st.LAN,
				"urls":     st.URLs,
				"firewall": st.FirewallState,
				"record":   st.Firewall,
			}, "", "  ")
			fmt.Println(string(raw))
		} else {
			fmt.Printf("Listen:   %s\n", st.Listen)
			if st.LAN {
				fmt.Println("Access:   LAN enabled")
				for _, u := range st.URLs {
					fmt.Println("          " + u)
				}
			} else {
				fmt.Println("Access:   loopback only")
			}
			if st.FirewallState != nil {
				fmt.Printf("Firewall: %s\n", firewallDescription(*st.FirewallState, st.Firewall, st.Port))
			}
		}
		return code

	case "on":
		// If a previous rule was recorded for another port, close it first.
		if old, ok := loadFirewallRecord(*data); ok && old.Port != 0 && old.Port != port {
			if err := closeFirewall(old, *yes); err != nil {
				fmt.Fprintf(os.Stderr, "arutosiod: close previous firewall rule: %v\n", err)
			} else {
				removeFirewallRecord(*data)
			}
		}
		wasLAN := isLANListen(cfg.Listen)
		cfg.Listen = fmt.Sprintf("0.0.0.0:%d", port)
		if err := saveConfig(*data, cfg); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: save config: %v\n", err)
			return 1
		}
		running := false
		if _, err := probeHealth(port); err == nil {
			running = true
		} else if portOpen(port) {
			running = true
		}
		if wasLAN && running {
			// Already exposed; only make sure the firewall matches.
		} else if running {
			if code := cmdRestart([]string{"--data", *data}); code != 0 {
				return code
			}
		} else {
			if code := cmdStart([]string{"--data", *data}); code != 0 {
				return code
			}
		}

		fw := detectFirewall(port)
		if !*noFirewall {
			if fw.Backend == "none" {
				fmt.Println("firewall: no ufw/firewalld detected")
			} else if !fw.Active && !fw.NeedsRoot {
				fmt.Printf("firewall: %s is installed but not active\n", fw.Backend)
			} else if fw.Active && fw.Allowed && !fw.NeedsRoot {
				fmt.Printf("firewall: %s already allows %d/tcp\n", fw.Backend, port)
			} else if *yes || askYesNo(fmt.Sprintf("Open %d/tcp in %s?", port, fw.Backend), false) {
				rec, _, err := openFirewall(port, *yes)
				if err != nil {
					fmt.Fprintf(os.Stderr, "arutosiod: firewall: %v\n", err)
					fmt.Printf("open it manually: %s\n", firewallManual(fw, port))
				} else if rec.Added {
					if err := saveFirewallRecord(*data, rec); err != nil {
						fmt.Fprintf(os.Stderr, "arutosiod: save firewall record: %v\n", err)
					}
					fmt.Printf("firewall: opened %s in %s\n", rec.Rule, rec.Backend)
				} else {
					fmt.Printf("firewall: %s already allows %d/tcp\n", fw.Backend, port)
				}
			} else {
				fmt.Printf("open it manually: %s\n", firewallManual(fw, port))
			}
		} else if fw.Active && !fw.Allowed {
			fmt.Printf("firewall: port closed; open it with: %s\n", firewallManual(fw, port))
		}

		urls := lanURLs(port)
		if *asJSON {
			raw, _ := json.MarshalIndent(map[string]any{"listen": cfg.Listen, "urls": urls}, "", "  ")
			fmt.Println(string(raw))
		} else {
			fmt.Println("LAN enabled:")
			for _, u := range urls {
				fmt.Println("  " + u)
			}
			fmt.Println("Use only on a trusted network: LAN traffic is HTTP, not TLS.")
		}
		return 0

	case "off":
		wasLAN := isLANListen(cfg.Listen)
		cfg.Listen = fmt.Sprintf("127.0.0.1:%d", port)
		if err := saveConfig(*data, cfg); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: save config: %v\n", err)
			return 1
		}
		code := 0
		if wasLAN && (systemdActive() || portOpen(port)) {
			code = cmdRestart([]string{"--data", *data})
		}
		if rec, ok := loadFirewallRecord(*data); ok {
			if err := closeFirewall(rec, *yes); err != nil {
				fmt.Fprintf(os.Stderr, "arutosiod: close firewall: %v\n", err)
				fmt.Printf("close it manually: %s\n", firewallCloseManual(rec))
				code = 1
			} else {
				removeFirewallRecord(*data)
				fmt.Printf("firewall: closed %s in %s\n", rec.Rule, rec.Backend)
			}
		}
		fmt.Printf("LAN disabled; listening on %s\n", cfg.Listen)
		return code

	default:
		fmt.Fprintln(os.Stderr, "usage: arutosiod lan on|off|status [options]")
		return 2
	}
}

func cmdFirewall(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: arutosiod firewall status|open|close [options]")
		return 2
	}
	action := args[0]
	fs := newSet("firewall " + action)
	data := addDataFlag(fs)
	portFlag := fs.Int("port", 0, "port (default: the configured port)")
	yes := fs.Bool("yes", false, "do not ask for confirmation")
	asJSON := fs.Bool("json", false, "machine-readable output")
	_ = fs.Parse(args[1:])

	cfg, _, _ := loadConfig(*data)
	port := *portFlag
	if port == 0 {
		port = listenPort(cfg.Listen)
	}

	switch action {
	case "status":
		st := detectFirewall(port)
		if *asJSON {
			raw, _ := json.MarshalIndent(st, "", "  ")
			fmt.Println(string(raw))
		} else {
			fmt.Printf("backend: %s\nallowed: %v\nactive: %v\n%s\n", st.Backend, st.Allowed, st.Active, st.Detail)
		}
		switch {
		case st.Backend == "none" || (st.Allowed && !st.NeedsRoot):
			return 0
		case st.NeedsRoot:
			return 2
		default:
			return 1
		}
	case "open":
		rec, st, err := openFirewall(port, *yes)
		if err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
			fmt.Printf("open it manually: %s\n", firewallManual(st, port))
			return 1
		}
		if rec.Added {
			if err := saveFirewallRecord(*data, rec); err != nil {
				fmt.Fprintf(os.Stderr, "arutosiod: save record: %v\n", err)
				return 1
			}
		}
		if *asJSON {
			raw, _ := json.MarshalIndent(map[string]any{"state": st, "record": rec}, "", "  ")
			fmt.Println(string(raw))
		} else if rec.Added {
			fmt.Printf("opened %s in %s\n", rec.Rule, rec.Backend)
		} else {
			fmt.Printf("%s already allows %d/tcp (or no firewall detected)\n", st.Backend, port)
		}
		return 0
	case "close":
		rec, ok := loadFirewallRecord(*data)
		if !ok {
			if *asJSON {
				fmt.Println(`{"closed":false,"reason":"no rule recorded"}`)
			} else {
				fmt.Println("no firewall rule recorded; nothing to close")
			}
			return 0
		}
		if err := closeFirewall(rec, *yes); err != nil {
			fmt.Fprintf(os.Stderr, "arutosiod: %v\n", err)
			fmt.Printf("close it manually: %s\n", firewallCloseManual(rec))
			return 1
		}
		removeFirewallRecord(*data)
		if *asJSON {
			raw, _ := json.MarshalIndent(map[string]any{"closed": true, "rule": rec.Rule, "backend": rec.Backend}, "", "  ")
			fmt.Println(string(raw))
		} else {
			fmt.Printf("closed %s in %s\n", rec.Rule, rec.Backend)
		}
		return 0
	default:
		fmt.Fprintln(os.Stderr, "usage: arutosiod firewall status|open|close [options]")
		return 2
	}
}

func cmdCompletion(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: arutosiod completion fish|bash|zsh")
		return 2
	}
	switch args[0] {
	case "fish":
		fmt.Print(`complete -c arutosiod -f
complete -c arutosiod -n __fish_use_subcommand -a status -d "Show status"
complete -c arutosiod -n __fish_use_subcommand -a start -d "Start the daemon"
complete -c arutosiod -n __fish_use_subcommand -a stop -d "Stop the daemon"
complete -c arutosiod -n __fish_use_subcommand -a restart -d "Restart the daemon"
complete -c arutosiod -n __fish_use_subcommand -a logs -d "Show logs"
complete -c arutosiod -n __fish_use_subcommand -a url -d "Print the local URL"
complete -c arutosiod -n __fish_use_subcommand -a token -d "Print the access token"
complete -c arutosiod -n __fish_use_subcommand -a version -d "Print the version"
complete -c arutosiod -n __fish_use_subcommand -a doctor -d "Run health checks"
complete -c arutosiod -n __fish_use_subcommand -a lan -d "Enable or disable LAN access"
complete -c arutosiod -n __fish_use_subcommand -a firewall -d "Inspect or change the firewall"
complete -c arutosiod -n __fish_use_subcommand -a update -d "Check or install updates"
complete -c arutosiod -n __fish_use_subcommand -a rollback -d "Roll back to the previous build"
complete -c arutosiod -n __fish_use_subcommand -a uninstall -d "Remove the daemon"
complete -c arutosiod -n __fish_use_subcommand -a completion -d "Print shell completions"
complete -c arutosiod -n __fish_use_subcommand -a serve -d "Run the server in the foreground"
complete -c arutosiod -n __fish_seen_subcommand_from lan -a "on off status"
complete -c arutosiod -n __fish_seen_subcommand_from firewall -a "status open close"
complete -c arutosiod -n __fish_seen_subcommand_from completion -a "fish bash zsh"
complete -c arutosiod -n __fish_seen_subcommand_from logs -s n -d "Number of lines"
complete -c arutosiod -n __fish_seen_subcommand_from logs -s f -l follow -d "Follow the log"
complete -c arutosiod -l data -d "Data directory" -r
complete -c arutosiod -l json -d "JSON output"
complete -c arutosiod -l yes -d "Do not ask for confirmation"
`)
	case "bash":
		fmt.Print(`_arutosiod() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "status start stop restart logs url token version doctor lan firewall update rollback uninstall completion serve help" -- "$cur") )
  fi
}
complete -F _arutosiod arutosiod
`)
	case "zsh":
		fmt.Print(`#compdef arutosiod
_arutosiod() {
  local -a cmds
  cmds=(status start stop restart logs url token version doctor lan firewall update rollback uninstall completion serve help)
  _describe 'command' cmds
}
_arutosiod "$@"
`)
	default:
		fmt.Fprintln(os.Stderr, "usage: arutosiod completion fish|bash|zsh")
		return 2
	}
	return 0
}
