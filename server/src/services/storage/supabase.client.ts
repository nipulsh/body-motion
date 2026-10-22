import { createClient } from '@supabase/supabase-js';
import { env } from '../../config/env';

/** Service-role client for auth verification and storage administration. */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
