// NEXCOM Exchange - Notification Service
// Multi-channel notification delivery: email, SMS, push, WebSocket, USSD.
// Consumes notification events from Kafka and routes to appropriate channels.

import express from 'express';
import helmet from 'helmet';
import { createLogger, format, transports } from 'winston';
import { notificationRouter } from './routes/notifications';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const app = express();
const PORT = process.env.PORT || 8008;

app.use(helmet());
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ status: 'healthy', service: 'notification' });
});
app.get('/readyz', (_req, res) => {
  res.json({ status: 'ready' });
});

app.use('/api/v1/notifications', notificationRouter);

app.listen(PORT, () => {
  logger.info(`Notification Service listening on port ${PORT}`);
});

export default app;
