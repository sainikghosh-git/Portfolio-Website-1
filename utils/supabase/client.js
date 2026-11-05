// Supabase browser client for static HTML/JS sites
// Usage: import { supabase } from '/utils/supabase/client.js'

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://izxaelynwbihpmanhzxg.supabase.co';
const supabaseKey = 'sb_publishable_FZKrnYMSfWyduSN6xm2C4w_6jwwuWHr';

export const supabase = createClient(supabaseUrl, supabaseKey);
