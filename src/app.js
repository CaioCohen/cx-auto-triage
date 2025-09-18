import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import ticketsRoutes from './routes/tickets.routes.js';
import answersRoutes from './routes/answers.routes.js';
import slackRoutes from './routes/slack.routes.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// sanity endpoints
app.get('/', (_req, res) => res.send('cx-auto-triage up'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// api routes
app.use('/api', ticketsRoutes);
app.use('/api', answersRoutes);
app.use('/slack', slackRoutes);

export default app;
