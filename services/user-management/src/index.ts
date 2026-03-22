// NEXCOM Exchange - User Management Service
// Handles user registration, KYC/AML workflows, and Keycloak identity management.
// Supports multi-tier users: farmers (USSD), retail traders, institutions, cooperatives.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger, format, transports } from 'winston';
import { userRouter } from './routes/users';
import { authRouter } from './routes/auth';
import { kycRouter } from './routes/kyc';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const app = express();
const PORT = process.env.PORT || 8012;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow KYC document uploads

// Health checks
app.get('/healthz', (_req, res) => {
  res.json({ status: 'healthy', service: 'user-management' });
});
app.get('/readyz', (_req, res) => {
  res.json({ status: 'ready' });
});

// Routes
app.use('/api/v1/users', userRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/kyc', kycRouter);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`User Management Service listening on port ${PORT}`);
});

export default app;
