# ---- 依赖与源码（verify/构建共用） ----
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# ---- 一次性验证服务：单元测试 + 类型检查/构建 + 固定板图联合布线冒烟 ----
FROM base AS verify
CMD ["npm", "run", "verify"]

# ---- 前端构建 ----
FROM base AS build
RUN npm run build

# ---- 运行态：nginx 静态托管 + /healthz ----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
