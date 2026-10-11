set -Eeuxo pipefail

tmux kill-session -t ytmurl || true
tmux new-session -d -s ytmurl 'micromamba run -n ytmurl python docker/ytmurl/run.py'

tmux kill-session -t neteaseapi || true
tmux new-session -d -s neteaseapi 'PORT=13000 micromamba run -n ytmurl yarn netease_api:run'

tmux kill-session -t yesplaymusic || true
tmux new-session -d -s yesplaymusic 'NODE_OPTIONS=--openssl-legacy-provider micromamba run -n ytmurl yarn serve'