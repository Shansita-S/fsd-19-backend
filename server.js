const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const dns = require('dns');

dotenv.config();

// Atlas uses SRV DNS lookups. If local DNS is flaky, allow stable public resolvers.
const dnsServers = (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (dnsServers.length > 0) {
  dns.setServers(dnsServers);
  console.log(`🌐 DNS servers: ${dnsServers.join(', ')}`);
}

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/meetings', require('./routes/meetings'));
app.use('/api/users', require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// MongoDB Connection with retry so temporary DNS/network blips don't crash startup.
const mongoOptions = {};
if (process.env.MONGODB_TLS_INSECURE === 'true') {
  // Dev-only escape hatch for networks that replace TLS certificates.
  mongoOptions.tlsAllowInvalidCertificates = true;
  console.warn('⚠️  MONGODB_TLS_INSECURE=true: TLS certificate verification is disabled');
}

const connectWithRetry = async (attempt = 1, maxAttempts = 5) => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
    console.log('✅ MongoDB Connected Successfully');
  } catch (err) {
    const rootCause = err?.cause?.message ? ` | cause: ${err.cause.message}` : '';
    console.error(`❌ MongoDB Connection Error (attempt ${attempt}/${maxAttempts}): ${err.message}${rootCause}`);
    if (attempt >= maxAttempts) {
      process.exit(1);
    }

    const delayMs = Math.min(3000 * attempt, 12000);
    console.log(`⏳ Retrying MongoDB connection in ${delayMs}ms...`);
    setTimeout(() => connectWithRetry(attempt + 1, maxAttempts), delayMs);
  }
};

connectWithRetry();

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!', 
    error: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
