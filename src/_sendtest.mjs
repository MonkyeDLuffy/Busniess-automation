import 'dotenv/config';
import { sendOutreachEmail } from './emailSender.js';

const r = await sendOutreachEmail({ to: 'vadukiyaearth@gmail.com', name: 'Test' });
console.log('SENT:', JSON.stringify(r));
