// SSA Two-Wheeler Parking — Production-Ready Server Entry Point
require('dotenv').config();
const env = require('./config/env'); // Strict environment validation on startup
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');

const requestId = require('./middleware/requestId');
const authRoutes = require('./routes/authRoutes');
const setupRoutes = require('./routes/setupRoutes');
const parkingRoutes = require('./routes/parkingRoutes');
const cronRoutes = require('./routes/cronRoutes');
const healthRoutes = require('./routes/healthRoutes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { startScheduler, stopScheduler } = require('./jobs/scheduler');
const db = require('./db');

const app = express();
const PORT = env.PORT || 5500;

// ─── 1. Request ID Tracing ────────────────────────────────────────────────────
app.use(requestId);

// ─── 2. Express Signature Removal ────────────────────────────────────────────
app.disable('x-powered-by');

// ─── 3. Request Logging (morgan) ─────────────────────────────────────────────
app.use(morgan(':method :url :status :res[content-length] - :response-time ms | IP: :remote-addr'));

// ─── 4. Response Compression ─────────────────────────────────────────────────
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    const ct = res.getHeader('Content-Type') || '';
    if (ct.includes('image/') || ct.includes('application/octet-stream')) return false;
    return compression.filter(req, res);
  }
}));

// ─── 5. Security Headers (Helmet + CSP) ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  xXssProtection: true,
  noSniff: true,
  frameguard: { action: 'sameorigin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false
}));

// Custom Permissions Policy Header
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ─── 6. CORS ─────────────────────────────────────────────────────────────────
const isDev = env.NODE_ENV === 'development';
const allowedOrigin = env.ALLOWED_ORIGIN;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isDev && (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || allowedOrigin === '*')) {
      return callback(null, true);
    }
    if (allowedOrigin === '*' || origin === allowedOrigin) return callback(null, true);
    const list = allowedOrigin.split(',').map(o => o.trim());
    if (list.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS policy: Origin '${origin}' is not allowed.`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ─── 7. Body Parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ─── 8. Trust Proxy (for Vercel / reverse proxies) ───────────────────────────
app.set('trust proxy', 1);

// ─── 9. Static Files (Frontend) ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname), { index: false }));

// ─── 10. API Routes ───────────────────────────────────────────────────────────
app.use('/api', authRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/parking', parkingRoutes);
app.use('/api/cron', cronRoutes);

// ─── 11. Health Check (GET /health) ──────────────────────────────────────────
app.use('/health', healthRoutes);

// ─── 12. Frontend SPA Fallback ────────────────────────────────────────────────
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'logo.png')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── 13. 404 & Global Error Handlers ─────────────────────────────────────────
app.use('/api', notFoundHandler);
app.use(errorHandler);

// ─── 14. Server Startup + Background Jobs ────────────────────────────────────
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`🚀 SSA Parking System running on http://localhost:${PORT}`);
    console.log(`🔐 Security Hardened | Env: ${env.NODE_ENV} | CORS: ${allowedOrigin}`);
    startScheduler();
  });

  // ─── 15. Graceful Shutdown ─────────────────────────────────────────────────
  async function gracefulShutdown(signal) {
    console.log(`\n[SHUTDOWN] Received ${signal} — shutting down gracefully...`);
    stopScheduler();
    server.close(async () => {
      await db.closePool();
      console.log('[SHUTDOWN] Server closed cleanly.');
      process.exit(0);
    });
    // Force exit after 10 seconds if graceful shutdown stalls
    setTimeout(() => {
      console.error('[SHUTDOWN] Forced exit after timeout.');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

module.exports = app;
