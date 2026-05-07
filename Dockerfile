FROM node:20.0-alpine as build-stage

WORKDIR /app

COPY package.json .

RUN npm config set registry https://registry.npmmirror.com/ 

RUN npm install

COPY . .
# RUN find /app -name ".env*" || echo "no .env found"   # 看看到底在哪
# 如果构建阶段需要生产环境变量，可以在这里设置
# ENV NODE_ENV=production
RUN npm run build

# production stage
FROM node:20.0-alpine as production-stage
# 安装bash
RUN apk add --no-cache bash
COPY --from=build-stage /app/dist /app
COPY --from=build-stage /app/package.json /app/package.json
# cicd的时候需要删除下面的代码 因为我不会把env传到github仓库
# COPY --from=build-stage /app/src/.env.production /app/.env.production 
WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com/ 

RUN npm install --production

# 设置运行时的环境变量
ENV NODE_ENV=production

EXPOSE 4000


CMD ["node", "/app/main.js"]