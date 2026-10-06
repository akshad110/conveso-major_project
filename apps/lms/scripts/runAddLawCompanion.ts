import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { addLawCompanion } from './addLawCompanion';

addLawCompanion().catch(console.error);
