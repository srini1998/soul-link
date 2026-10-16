"""Host the whole backend in ONE Daytona sandbox and print its public preview URL.

  python deploy_daytona.py              # create a new sandbox + start server
  python deploy_daytona.py <sandboxId>  # re-upload main.py/.env into an existing sandbox + restart

Needs DAYTONA_API_KEY in env (or backend/.env). Other keys in .env are passed to the sandbox.
"""
import os
import sys
import time
from pathlib import Path

import httpx
from daytona import CreateSandboxFromSnapshotParams, Daytona, DaytonaConfig, SessionExecuteRequest

HERE = Path(__file__).parent
PORT = 8000


def read_env() -> dict:
    env = {}
    p = HERE / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if v.strip():
                    env[k.strip()] = v.strip()
    return env


def main():
    env = read_env()
    api_key = os.getenv("DAYTONA_API_KEY") or env.pop("DAYTONA_API_KEY", None)
    if not api_key:
        sys.exit("DAYTONA_API_KEY missing")
    env.pop("DAYTONA_API_KEY", None)
    api_url = os.getenv("DAYTONA_API_URL") or env.pop("DAYTONA_API_URL", "https://app.daytona.io/api")
    env.pop("DAYTONA_API_URL", None)
    daytona = Daytona(DaytonaConfig(api_key=api_key, api_url=api_url))

    if len(sys.argv) > 1:
        sb = daytona.get(sys.argv[1])
        print(f"reusing sandbox {sb.id}")
    else:
        t = time.time()
        sb = daytona.create(CreateSandboxFromSnapshotParams(
            language="python", public=True, env_vars=env, auto_stop_interval=0,
            labels={"app": "soul-link"}))
        print(f"created sandbox {sb.id} in {time.time() - t:.2f}s")

    workdir = sb.get_work_dir()
    app_dir = f"{workdir}/app"
    sb.process.exec(f"mkdir -p {app_dir}")
    for name in ("main.py", "requirements.txt"):
        sb.fs.upload_file((HERE / name).read_bytes(), f"{app_dir}/{name}")
    # .env inside the sandbox too, so reuse/restart picks up new keys
    sb.fs.upload_file("\n".join(f"{k}={v}" for k, v in env.items()).encode(), f"{app_dir}/.env")

    r = sb.process.exec("pip install -q -r requirements.txt", cwd=app_dir, timeout=300)
    print(f"pip exit {r.exit_code}: {r.result[-500:]}")

    sb.process.exec(f"pkill -f 'main.py' || true")
    sid = f"server-{int(time.time())}"
    sb.process.create_session(sid)
    sb.process.execute_session_command(sid, SessionExecuteRequest(
        command=f"cd {app_dir} && DISABLE_CORS=1 PORT={PORT} python main.py > server.log 2>&1", run_async=True))

    link = sb.get_preview_link(PORT)
    url = link.url.rstrip("/")
    for _ in range(30):
        try:
            res = httpx.get(url + "/", timeout=5, headers={"x-daytona-preview-token": link.token})
            if res.status_code == 200:
                print("health:", res.text)
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        print("server did not answer yet; logs:")
        print(sb.process.exec(f"tail -50 {app_dir}/server.log").result)

    print(f"\nSANDBOX_ID={sb.id}\nBACKEND_URL={url}\n(preview token, only needed if not public: {link.token})")


if __name__ == "__main__":
    main()
