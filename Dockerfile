# =============================================================================
# Build YesPlayMusic frontend
# =============================================================================
FROM node:16-alpine AS build

ENV VUE_APP_NETEASE_API_URL=/api

RUN apk add --no-cache python3 make g++ git

WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# =============================================================================
# Runtime — nginx + NetEase API + ytmurl
# =============================================================================
FROM node:16-alpine

ENV PYTHONUNBUFFERED=1

COPY docker/ytmurl/requirements.txt /opt/ytmurl/requirements.txt
COPY package.json /tmp/package.json

RUN apk add --no-cache nginx python3 py3-pip \
  && pip3 install --no-cache-dir -r /opt/ytmurl/requirements.txt \
  && npm install -g "@neteaseapireborn/api@$(node -p "require('/tmp/package.json').dependencies['@neteaseapireborn/api'].replace(/^\^/, '')")" \
  && rm /tmp/package.json

COPY docker/ytmurl/ /opt/ytmurl/
COPY docker/nginx.conf.example /etc/nginx/http.d/default.conf
COPY docker/start.sh /usr/local/bin/start.sh
COPY --from=build /app/dist /usr/share/nginx/html

RUN chmod +x /usr/local/bin/start.sh

EXPOSE 80
CMD ["/usr/local/bin/start.sh"]
