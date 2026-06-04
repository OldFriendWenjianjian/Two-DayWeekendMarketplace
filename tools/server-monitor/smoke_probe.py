import importlib.util
from pathlib import Path


def load_monitor_module():
    path = Path(__file__).with_name("server_monitor.py")
    spec = importlib.util.spec_from_file_location("server_monitor", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def main() -> None:
    monitor = load_monitor_module()
    config = dict(monitor.DEFAULT_CONFIG)
    state = monitor.MonitorState()
    urls = monitor.build_urls(config)

    class Probe:
        def __init__(self):
            self.state = state
            self.events = type("Events", (), {"put": lambda self, item: None})()

        observe_payload = monitor.ServerMonitorApp.observe_payload
        fetch_endpoint = monitor.ServerMonitorApp.fetch_endpoint

    probe = Probe()
    for name in ["health", "marketplace", "download_meta", "live_sessions"]:
        state.endpoints[name] = monitor.EndpointStat(name, urls[name])
        probe.fetch_endpoint(name, urls[name], config["request_timeout_seconds"])
        endpoint = state.endpoints[name]
        print(f"{name}: {endpoint.last_status} {endpoint.last_ms:.0f}ms {endpoint.last_error}")

    assert state.endpoints["health"].ok_count == 1
    assert state.endpoints["marketplace"].ok_count == 1
    print(
        "summary:",
        f"products={state.product_count}",
        f"stores={state.store_count}",
        f"live={state.live_room_count}",
        f"ledger={state.ledger_height}",
        f"apk={state.apk_available}",
    )


if __name__ == "__main__":
    main()
