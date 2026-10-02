# 彩虹泡泡砲 後端（Cloud Run／任何容器平台）
# 專案零依賴，不需要 npm install；只打包執行需要的檔案。
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
# Cloud Run 會注入 PORT（預設 8080），server.js 會讀它
ENV PORT=8080

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

USER node
EXPOSE 8080
CMD ["node", "server.js"]
