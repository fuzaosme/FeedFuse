/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Next.js 仅支持在项目根读取 next.config，这里保留唯一根配置入口。
  poweredByHeader: false,
  // Next.js 16 默认只信任 localhost；用 127.0.0.1 或局域网 IP 访问开发服务时，
  // HMR/客户端 bootstrap 会被当作跨域请求拦截，导致 React 无法 hydration
  // （表现为登录按钮无反应，表单退化为原生 GET 提交）。这里显式放行本地开发来源。
  allowedDevOrigins: ['localhost', '127.0.0.1', '192.168.0.206'],
  experimental: {
    // 对高频图标库做按需导入重写，减少客户端打包体积。
    optimizePackageImports: ['lucide-react'],
  },
  typescript: {
    // 复用生产类型检查范围，避免测试夹具的类型错误阻断发布构建。
    tsconfigPath: 'config/typescript/tsconfig.typecheck.json',
  },
};

export default nextConfig;
