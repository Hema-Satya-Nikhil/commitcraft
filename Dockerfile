FROM node:22.14.0-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js vitest.config.js .nvmrc ./
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM nginx:1.27.4-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 4173

CMD ["nginx", "-g", "daemon off;"]
