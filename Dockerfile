FROM node:16.13.1-alpine as build
ENV VUE_APP_NETEASE_API_URL=/api
WORKDIR /app
RUN apk add --no-cache python3 make g++ git
COPY package.json yarn.lock ./
RUN yarn install
COPY . .
RUN yarn build

FROM nginx:1.20.2-alpine as app

COPY --from=build /app/package.json /usr/local/lib/

RUN apk add --no-cache --repository http://dl-cdn.alpinelinux.org/alpine/v3.14/main libuv jq \
  && apk add --no-cache --update-cache --repository http://dl-cdn.alpinelinux.org/alpine/v3.14/main nodejs npm \
  && npm i -g NeteaseCloudMusicApi@"$(jq -r '.dependencies.NeteaseCloudMusicApi' /usr/local/lib/package.json)"

COPY --from=build /app/dist /usr/share/nginx/html

RUN apk add g++ python3 py3-pip python3-dev
RUN pip install ytmurl

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY ytmservice.py /etc/ytmservice/app.py

CMD nginx & exec npx NeteaseCloudMusicApi & python3 /etc/ytmservice/app.py
