import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import methodOverride from 'method-override';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Ensure upload directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'video-' + Date.now() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// View Engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser('antrian-secret-key-12345'));
app.use(methodOverride('_method'));
app.use(methodOverride((req) => {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const m = req.body._method;
    delete req.body._method;
    return m;
  }
}));

// In-memory Database Store
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const db = {
  users: [
    { id: 1, name: 'Administrator', email: 'admin@antrian.test', password: 'password', role: 'admin' },
    { id: 2, name: 'Operator 1', email: 'operator1@antrian.test', password: 'password', role: 'operator' },
    { id: 3, name: 'Operator 2', email: 'operator2@antrian.test', password: 'password', role: 'operator' },
  ],
  services: [
    { id: 1, name: 'Layanan Umum', prefix: 'A', sort_order: 1, description: 'Pendaftaran & informasi umum', is_active: true },
    { id: 2, name: 'Pembayaran', prefix: 'B', sort_order: 2, description: 'Kasir & pembayaran', is_active: true },
    { id: 3, name: 'Customer Service', prefix: 'C', sort_order: 3, description: 'Pengaduan & bantuan', is_active: true },
  ],
  counters: [
    { id: 1, name: 'Loket 1', number: 1, sort_order: 1, services: [1], is_active: true, occupied_by: null, occupied_at: null },
    { id: 2, name: 'Loket 2', number: 2, sort_order: 2, services: [1, 2], is_active: true, occupied_by: null, occupied_at: null },
    { id: 3, name: 'Loket 3', number: 3, sort_order: 3, services: [3], is_active: true, occupied_by: null, occupied_at: null },
  ],
  displaySettings: {
    company_name: 'ANTRIANKU',
    tagline: 'LAYANAN LEBIH MUDAH',
    running_text: 'Selamat datang di layanan kami • Mohon menunggu hingga nomor antrean Anda dipanggil • Terima kasih atas kesabaran Anda •',
    video_url: '',
    video_path: '',
    get video_source() {
      return this.video_path || this.video_url || '';
    },
  },
  tickets: [],
  nextTicketId: 1,
  nextServiceId: 4,
  nextCounterId: 4,
  nextUserId: 4,
};

// Seed a few initial demo tickets for today
const today = getTodayString();
const initialDemoTickets = [
  { service_id: 1, number: 1, code: 'A001', status: 'done', queue_date: today, created_at: new Date(Date.now() - 3600000), called_at: new Date(Date.now() - 3300000), served_at: new Date(Date.now() - 3300000), finished_at: new Date(Date.now() - 3000000), counter_id: 1 },
  { service_id: 2, number: 1, code: 'B001', status: 'done', queue_date: today, created_at: new Date(Date.now() - 3000000), called_at: new Date(Date.now() - 2700000), served_at: new Date(Date.now() - 2700000), finished_at: new Date(Date.now() - 2400000), counter_id: 2 },
  { service_id: 1, number: 2, code: 'A002', status: 'called', queue_date: today, created_at: new Date(Date.now() - 1800000), called_at: new Date(Date.now() - 600000), served_at: new Date(Date.now() - 600000), finished_at: null, counter_id: 1 },
  { service_id: 1, number: 3, code: 'A003', status: 'waiting', queue_date: today, created_at: new Date(Date.now() - 1200000), called_at: null, served_at: null, finished_at: null, counter_id: null },
  { service_id: 3, number: 1, code: 'C001', status: 'waiting', queue_date: today, created_at: new Date(Date.now() - 600000), called_at: null, served_at: null, finished_at: null, counter_id: null },
];
for (const t of initialDemoTickets) {
  db.tickets.push({ id: db.nextTicketId++, ...t });
}

// Stale counter release (15 min idle)
function releaseStaleCounters() {
  const timeoutMs = 15 * 60 * 1000;
  const now = Date.now();
  for (const c of db.counters) {
    if (c.occupied_by !== null && c.occupied_at) {
      if (now - new Date(c.occupied_at).getTime() > timeoutMs) {
        c.occupied_by = null;
        c.occupied_at = null;
      }
    }
  }
}

// Real-time Server-Sent Events (SSE)
const sseClients = new Set();

function broadcastEvent(eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Send initial keep-alive
  res.write(': connected\n\n');

  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (e) {
      clearInterval(keepAliveInterval);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
    sseClients.delete(res);
  });
});

// Auth helper middleware
function getAuthUser(req) {
  try {
    const raw = req.signedCookies.auth_user || req.cookies.auth_user;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ message: 'Unauthenticated.' });
    }
    return res.redirect('/login');
  }
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.role === 'admin') return next(); // Admin has all permissions
    if (req.user.role === role) return next();
    return res.status(403).send('Akses tidak diizinkan.');
  };
}

// Global context middleware
app.use((req, res, next) => {
  res.locals.user = getAuthUser(req);
  res.locals.csrfToken = 'csrf-token-placeholder';
  next();
});

// ----------------------------------------------------
// Routes
// ----------------------------------------------------

// 1. Home -> Kiosk
app.get('/', (req, res) => {
  res.redirect('/kiosk');
});

// 2. Authentication
app.get('/login', (req, res) => {
  const user = getAuthUser(req);
  if (user) {
    return res.redirect(user.role === 'admin' ? '/admin/counters' : '/operator');
  }
  res.render('auth/login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find((u) => u.email === email && u.password === password);
  if (!user) {
    return res.render('auth/login', {
      email,
      error: 'Email atau kata sandi salah. Silakan coba lagi.',
    });
  }

  const sessionData = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.cookie('auth_user', JSON.stringify(sessionData), {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
  });

  if (user.role === 'admin') {
    res.redirect('/admin/counters');
  } else {
    res.redirect('/operator');
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('auth_user');
  res.redirect('/login');
});

// 3. Kiosk (Ambil Tiket)
app.get('/kiosk', (req, res) => {
  const activeServices = db.services
    .filter((s) => s.is_active)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  res.render('kiosk/index', { services: activeServices });
});

app.post('/kiosk/take', (req, res) => {
  const serviceId = parseInt(req.body.service_id, 10);
  const service = db.services.find((s) => s.id === serviceId && s.is_active);
  if (!service) {
    return res.status(404).json({ message: 'Layanan tidak ditemukan atau tidak aktif.' });
  }

  const curDate = getTodayString();
  const existingToday = db.tickets.filter(
    (t) => t.service_id === service.id && t.queue_date === curDate
  );
  const lastNumber = existingToday.reduce((max, t) => Math.max(max, t.number), 0);
  const number = lastNumber + 1;
  const code = `${service.prefix}${String(number).padStart(3, '0')}`;

  const newTicket = {
    id: db.nextTicketId++,
    service_id: service.id,
    counter_id: null,
    number,
    code,
    status: 'waiting',
    queue_date: curDate,
    created_at: new Date(),
    called_at: null,
    served_at: null,
    finished_at: null,
  };
  db.tickets.push(newTicket);

  broadcastEvent('queue.updated', { action: 'ticket-issued', ticket: newTicket });

  const ahead = db.tickets.filter(
    (t) =>
      t.service_id === service.id &&
      t.queue_date === curDate &&
      t.status === 'waiting' &&
      t.number < number
  ).length;

  res.json({
    id: newTicket.id,
    code: newTicket.code,
    number: newTicket.number,
    service: service.name,
    ahead,
    print_url: `/kiosk/ticket/${newTicket.id}/print`,
  });
});

app.get('/kiosk/ticket/:id/print', (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = db.tickets.find((t) => t.id === ticketId);
  if (!ticket) {
    return res.status(404).send('Tiket tidak ditemukan.');
  }

  const service = db.services.find((s) => s.id === ticket.service_id);
  const ahead = db.tickets.filter(
    (t) =>
      t.service_id === ticket.service_id &&
      t.queue_date === ticket.queue_date &&
      t.status === 'waiting' &&
      t.number < ticket.number
  ).length;

  const d = new Date(ticket.created_at);
  const formattedDate = d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const formattedTime = d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });

  res.render('kiosk/ticket', {
    ticket: { ...ticket, service_name: service?.name },
    ahead,
    formattedDate,
    formattedTime,
    appName: db.displaySettings.company_name || 'SISTEM ANTRIAN',
  });
});

// 4. Layar Display
app.get('/display', (req, res) => {
  res.render('display/index', { settings: db.displaySettings });
});

app.get('/display/state', (req, res) => {
  const curDate = getTodayString();
  const todayTickets = db.tickets.filter((t) => t.queue_date === curDate);

  // Active tickets per counter (called or serving)
  const activeTickets = todayTickets
    .filter((t) => ['called', 'serving'].includes(t.status) && t.counter_id !== null)
    .sort((a, b) => new Date(b.called_at || 0).getTime() - new Date(a.called_at || 0).getTime());

  // Unique per counter_id
  const seenCounters = new Set();
  const active = [];
  for (const t of activeTickets) {
    if (!seenCounters.has(t.counter_id)) {
      seenCounters.add(t.counter_id);
      const service = db.services.find((s) => s.id === t.service_id);
      const counter = db.counters.find((c) => c.id === t.counter_id);
      active.push({
        code: t.code,
        service: service?.name,
        counter_name: counter?.name,
        counter_number: counter?.number,
        called_at: t.called_at ? new Date(t.called_at).toISOString() : null,
      });
    }
  }

  // Last called ticket
  const lastTicket = todayTickets
    .filter((t) => t.called_at !== null)
    .sort((a, b) => new Date(b.called_at).getTime() - new Date(a.called_at).getTime())[0];

  let last = null;
  if (lastTicket) {
    const counter = db.counters.find((c) => c.id === lastTicket.counter_id);
    last = {
      code: lastTicket.code,
      counter_name: counter?.name,
      counter_number: counter?.number,
    };
  }

  const counters = db.counters
    .filter((c) => c.is_active)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.number - b.number)
    .map((counter) => {
      const activeItem = active.find((a) => a.counter_number === counter.number);
      return {
        name: counter.name,
        number: counter.number,
        code: activeItem?.code || null,
      };
    });

  res.json({
    active,
    counters,
    last,
  });
});

// 5. Operator
app.get('/operator', requireAuth, requireRole('operator'), (req, res) => {
  releaseStaleCounters();
  const userId = req.user.id;

  const counters = db.counters
    .filter((c) => c.is_active)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.number - b.number)
    .map((c) => {
      const occupant = db.users.find((u) => u.id === c.occupied_by);
      return {
        ...c,
        occupant_name: occupant?.name,
      };
    });

  const myCounter = counters.find((c) => c.occupied_by === userId) || null;

  res.render('operator/index', {
    counters,
    myCounter,
    user: req.user,
    error: req.query.error || null,
    status: req.query.status || null,
  });
});

app.post('/operator/:id/claim', requireAuth, requireRole('operator'), (req, res) => {
  releaseStaleCounters();
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId && c.is_active);
  if (!counter) {
    return res.redirect('/operator?error=' + encodeURIComponent('Loket tidak ditemukan atau tidak aktif.'));
  }

  const userId = req.user.id;
  const timeoutMs = 15 * 60 * 1000;
  const isFreshOccupant =
    counter.occupied_at && Date.now() - new Date(counter.occupied_at).getTime() < timeoutMs;

  if (counter.occupied_by !== null && counter.occupied_by !== userId && isFreshOccupant) {
    return res.redirect('/operator?error=' + encodeURIComponent('Loket tersebut sedang digunakan operator lain.'));
  }

  // Release previous counters occupied by this user
  for (const c of db.counters) {
    if (c.occupied_by === userId && c.id !== counter.id) {
      c.occupied_by = null;
      c.occupied_at = null;
    }
  }

  counter.occupied_by = userId;
  counter.occupied_at = new Date();

  res.redirect(`/operator/${counter.id}`);
});

app.post('/operator/:id/release', requireAuth, requireRole('operator'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (counter && counter.occupied_by === req.user.id) {
    counter.occupied_by = null;
    counter.occupied_at = null;
  }
  res.redirect('/operator?status=' + encodeURIComponent('Loket telah dilepas.'));
});

app.post('/operator/:id/heartbeat', requireAuth, requireRole('operator'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (!counter || counter.occupied_by !== req.user.id) {
    return res.status(409).json({ ok: false, message: 'Loket tidak lagi Anda tempati.' });
  }
  counter.occupied_at = new Date();
  res.json({ ok: true });
});

app.get('/operator/:id', requireAuth, requireRole('operator'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (!counter || counter.occupied_by !== req.user.id) {
    return res.redirect('/operator?error=' + encodeURIComponent('Anda belum memilih loket ini atau loket sedang dipakai operator lain.'));
  }
  res.render('operator/panel', { counter, user: req.user });
});

app.get('/operator/:id/state', requireAuth, requireRole('operator'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (!counter) return res.status(404).json({ message: 'Loket tidak ditemukan.' });

  const curDate = getTodayString();
  const currentTicket = db.tickets
    .filter((t) => t.counter_id === counter.id && t.queue_date === curDate && ['called', 'serving'].includes(t.status))
    .sort((a, b) => new Date(b.called_at || 0).getTime() - new Date(a.called_at || 0).getTime())[0] || null;

  const counterServices = db.services.filter((s) => (counter.services || []).includes(s.id));
  const waiting = counterServices.map((service) => {
    const count = db.tickets.filter(
      (t) => t.service_id === service.id && t.queue_date === curDate && t.status === 'waiting'
    ).length;
    return {
      service_id: service.id,
      service: service.name,
      waiting: count,
    };
  });

  res.json({
    counter: { id: counter.id, name: counter.name, number: counter.number },
    current: currentTicket ? { id: currentTicket.id, code: currentTicket.code, status: currentTicket.status } : null,
    waiting,
  });
});

app.post('/operator/:id/call-next', requireAuth, requireRole('operator'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (!counter || counter.occupied_by !== req.user.id) {
    return res.status(403).json({ message: 'Sesi loket tidak valid.' });
  }

  const curDate = getTodayString();
  const serviceIds = counter.services || [];

  const nextTicket = db.tickets
    .filter((t) => serviceIds.includes(t.service_id) && t.queue_date === curDate && t.status === 'waiting')
    .sort((a, b) => a.number - b.number)[0];

  if (!nextTicket) {
    return res.status(404).json({ message: 'Tidak ada antrian menunggu.' });
  }

  nextTicket.counter_id = counter.id;
  nextTicket.status = 'called';
  nextTicket.called_at = new Date();
  nextTicket.served_at = new Date();

  const service = db.services.find((s) => s.id === nextTicket.service_id);

  const callPayload = {
    id: nextTicket.id,
    code: nextTicket.code,
    number: nextTicket.number,
    status: nextTicket.status,
    service: service?.name,
    counter_id: counter.id,
    counter_name: counter.name,
    counter_number: counter.number,
    audio: {
      code_digits: String(nextTicket.number).split(''),
      code_prefix: service?.prefix,
      counter_number: counter.number,
    },
    called_at: nextTicket.called_at.toISOString(),
  };

  broadcastEvent('ticket.called', callPayload);
  broadcastEvent('queue.updated', { action: 'called-next', ticket: nextTicket });

  res.json({ code: nextTicket.code, id: nextTicket.id });
});

app.post('/operator/:id/recall', requireAuth, requireRole('operator'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (!counter || counter.occupied_by !== req.user.id) {
    return res.status(403).json({ message: 'Sesi loket tidak valid.' });
  }

  const curDate = getTodayString();
  const currentTicket = db.tickets
    .filter((t) => t.counter_id === counter.id && t.queue_date === curDate && ['called', 'serving'].includes(t.status))
    .sort((a, b) => new Date(b.called_at || 0).getTime() - new Date(a.called_at || 0).getTime())[0];

  if (!currentTicket) {
    return res.status(404).json({ message: 'Tidak ada nomor aktif untuk dipanggil ulang.' });
  }

  currentTicket.status = 'called';
  currentTicket.called_at = new Date();

  const service = db.services.find((s) => s.id === currentTicket.service_id);

  const callPayload = {
    id: currentTicket.id,
    code: currentTicket.code,
    number: currentTicket.number,
    status: currentTicket.status,
    service: service?.name,
    counter_id: counter.id,
    counter_name: counter.name,
    counter_number: counter.number,
    audio: {
      code_digits: String(currentTicket.number).split(''),
      code_prefix: service?.prefix,
      counter_number: counter.number,
    },
    called_at: currentTicket.called_at.toISOString(),
  };

  broadcastEvent('ticket.called', callPayload);

  res.json({ code: currentTicket.code, id: currentTicket.id });
});

app.post('/operator/:id/finish', requireAuth, requireRole('operator'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (!counter || counter.occupied_by !== req.user.id) {
    return res.status(403).json({ message: 'Sesi loket tidak valid.' });
  }

  const curDate = getTodayString();
  const currentTicket = db.tickets
    .filter((t) => t.counter_id === counter.id && t.queue_date === curDate && ['called', 'serving'].includes(t.status))
    .sort((a, b) => new Date(b.called_at || 0).getTime() - new Date(a.called_at || 0).getTime())[0];

  if (!currentTicket) {
    return res.status(404).json({ message: 'Tidak ada nomor aktif.' });
  }

  currentTicket.status = 'done';
  currentTicket.finished_at = new Date();

  broadcastEvent('queue.updated', { action: 'finished', ticketId: currentTicket.id });
  res.json({ ok: true });
});

app.post('/operator/:id/skip', requireAuth, requireRole('operator'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (!counter || counter.occupied_by !== req.user.id) {
    return res.status(403).json({ message: 'Sesi loket tidak valid.' });
  }

  const curDate = getTodayString();
  const currentTicket = db.tickets
    .filter((t) => t.counter_id === counter.id && t.queue_date === curDate && ['called', 'serving'].includes(t.status))
    .sort((a, b) => new Date(b.called_at || 0).getTime() - new Date(a.called_at || 0).getTime())[0];

  if (!currentTicket) {
    return res.status(404).json({ message: 'Tidak ada nomor aktif.' });
  }

  currentTicket.status = 'skipped';
  currentTicket.finished_at = new Date();

  broadcastEvent('queue.updated', { action: 'skipped', ticketId: currentTicket.id });
  res.json({ ok: true });
});

// 6. Admin Panel
app.get('/admin', requireAuth, requireRole('admin'), (req, res) => {
  res.redirect('/admin/counters');
});

// Admin Counters
app.get('/admin/counters', requireAuth, requireRole('admin'), (req, res) => {
  const counters = db.counters.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.number - b.number);
  res.render('admin/counters', {
    counters,
    services: db.services,
    status: req.query.status || null,
  });
});

// DataTables Server-Side endpoint for Counters
app.get('/admin/counters/dt', requireAuth, requireRole('admin'), (req, res) => {
  const draw = parseInt(req.query.draw, 10) || 1;
  const start = parseInt(req.query.start, 10) || 0;
  const length = parseInt(req.query.length, 10) || 10;
  const searchVal = (req.query.search && req.query.search.value) ? req.query.search.value.toLowerCase().trim() : '';

  let list = db.counters.slice();
  const recordsTotal = list.length;

  if (searchVal) {
    list = list.filter((c) => {
      const matchName = (c.name || '').toLowerCase().includes(searchVal);
      const matchNum = String(c.number || '').includes(searchVal);
      const svcNames = (c.services || []).map((sid) => {
        const s = db.services.find((x) => x.id === sid);
        return s ? s.name.toLowerCase() : '';
      }).join(' ');
      return matchName || matchNum || svcNames.includes(searchVal);
    });
  }

  // Sorting
  const orderColIdx = req.query.order && req.query.order[0] ? parseInt(req.query.order[0].column, 10) : 1;
  const orderDir = req.query.order && req.query.order[0] && req.query.order[0].dir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    if (orderColIdx === 0) return (a.name || '').localeCompare(b.name || '') * orderDir;
    if (orderColIdx === 1) return ((a.number || 0) - (b.number || 0)) * orderDir;
    if (orderColIdx === 3) return (((a.is_active ? 1 : 0) - (b.is_active ? 1 : 0))) * orderDir;
    return ((a.sort_order || 0) - (b.sort_order || 0)) * orderDir;
  });

  const recordsFiltered = list.length;
  const paged = list.slice(start, start + length);

  const data = paged.map((c) => {
    const assignedServices = (c.services || []).map((sid) => {
      const s = db.services.find((item) => item.id === sid);
      return s ? { id: s.id, name: s.name, prefix: s.prefix } : null;
    }).filter(Boolean);

    return {
      id: c.id,
      name: c.name,
      number: c.number,
      sort_order: c.sort_order || 0,
      services: c.services || [],
      assigned_services: assignedServices,
      is_active: !!c.is_active,
    };
  });

  res.json({
    draw,
    recordsTotal,
    recordsFiltered,
    data,
  });
});

app.post('/admin/counters', requireAuth, requireRole('admin'), (req, res) => {
  const { name, number, sort_order, is_active } = req.body;
  let serviceIds = req.body.services || [];
  if (!Array.isArray(serviceIds)) {
    serviceIds = [serviceIds];
  }
  const servicesParsed = serviceIds.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));

  const newCounter = {
    id: db.nextCounterId++,
    name: (name || 'Loket Baru').trim(),
    number: parseInt(number, 10) || (db.counters.length + 1),
    sort_order: parseInt(sort_order, 10) || 0,
    services: servicesParsed,
    is_active: is_active === '1' || is_active === true || is_active === 'true',
    occupied_by: null,
    occupied_at: null,
  };
  db.counters.push(newCounter);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Loket berhasil ditambahkan.', data: newCounter });
  }
  res.redirect('/admin/counters?status=' + encodeURIComponent('Loket berhasil ditambahkan.'));
});

app.put('/admin/counters/:id', requireAuth, requireRole('admin'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const counter = db.counters.find((c) => c.id === counterId);
  if (counter) {
    const { name, number, sort_order, is_active } = req.body;
    let serviceIds = req.body.services || [];
    if (!Array.isArray(serviceIds)) {
      serviceIds = [serviceIds];
    }
    counter.name = name ? name.trim() : counter.name;
    counter.number = parseInt(number, 10) || counter.number;
    if (sort_order !== undefined) {
      counter.sort_order = parseInt(sort_order, 10) || 0;
    }
    counter.services = serviceIds.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    counter.is_active = is_active === '1' || is_active === true || is_active === 'true';
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Loket berhasil diperbarui.', data: counter });
  }
  res.redirect('/admin/counters?status=' + encodeURIComponent('Loket berhasil diperbarui.'));
});

app.delete('/admin/counters/:id', requireAuth, requireRole('admin'), (req, res) => {
  const counterId = parseInt(req.params.id, 10);
  const idx = db.counters.findIndex((c) => c.id === counterId);
  if (idx !== -1) {
    db.counters.splice(idx, 1);
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Loket berhasil dihapus.' });
  }
  res.redirect('/admin/counters?status=' + encodeURIComponent('Loket berhasil dihapus.'));
});

// Admin Services
app.get('/admin/services', requireAuth, requireRole('admin'), (req, res) => {
  const services = db.services.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  res.render('admin/services', {
    services,
    status: req.query.status || null,
  });
});

// DataTables Server-Side endpoint for Services
app.get('/admin/services/dt', requireAuth, requireRole('admin'), (req, res) => {
  const draw = parseInt(req.query.draw, 10) || 1;
  const start = parseInt(req.query.start, 10) || 0;
  const length = parseInt(req.query.length, 10) || 10;
  const searchVal = (req.query.search && req.query.search.value) ? req.query.search.value.toLowerCase().trim() : '';

  let list = db.services.slice();
  const recordsTotal = list.length;

  if (searchVal) {
    list = list.filter((s) => {
      const matchName = (s.name || '').toLowerCase().includes(searchVal);
      const matchPrefix = (s.prefix || '').toLowerCase().includes(searchVal);
      const matchDesc = (s.description || '').toLowerCase().includes(searchVal);
      return matchName || matchPrefix || matchDesc;
    });
  }

  const orderColIdx = req.query.order && req.query.order[0] ? parseInt(req.query.order[0].column, 10) : 0;
  const orderDir = req.query.order && req.query.order[0] && req.query.order[0].dir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    if (orderColIdx === 0) return (a.name || '').localeCompare(b.name || '') * orderDir;
    if (orderColIdx === 1) return (a.prefix || '').localeCompare(b.prefix || '') * orderDir;
    if (orderColIdx === 2) return (a.description || '').localeCompare(b.description || '') * orderDir;
    if (orderColIdx === 3) return (((a.is_active ? 1 : 0) - (b.is_active ? 1 : 0))) * orderDir;
    return ((a.sort_order || 0) - (b.sort_order || 0)) * orderDir;
  });

  const recordsFiltered = list.length;
  const paged = list.slice(start, start + length);

  res.json({
    draw,
    recordsTotal,
    recordsFiltered,
    data: paged,
  });
});

app.post('/admin/services', requireAuth, requireRole('admin'), (req, res) => {
  const { name, prefix, sort_order, description, is_active } = req.body;
  const newService = {
    id: db.nextServiceId++,
    name: (name || 'Layanan Baru').trim(),
    prefix: (prefix || 'A').toUpperCase().trim(),
    sort_order: parseInt(sort_order, 10) || 0,
    description: (description || '').trim(),
    is_active: is_active === '1' || is_active === true || is_active === 'true',
  };
  db.services.push(newService);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Layanan berhasil ditambahkan.', data: newService });
  }
  res.redirect('/admin/services?status=' + encodeURIComponent('Layanan berhasil ditambahkan.'));
});

app.put('/admin/services/:id', requireAuth, requireRole('admin'), (req, res) => {
  const serviceId = parseInt(req.params.id, 10);
  const service = db.services.find((s) => s.id === serviceId);
  if (service) {
    const { name, prefix, sort_order, description, is_active } = req.body;
    service.name = name ? name.trim() : service.name;
    service.prefix = prefix ? prefix.toUpperCase().trim() : service.prefix;
    if (sort_order !== undefined) {
      service.sort_order = parseInt(sort_order, 10) || 0;
    }
    service.description = description !== undefined ? description.trim() : service.description;
    service.is_active = is_active === '1' || is_active === true || is_active === 'true';
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Layanan berhasil diperbarui.', data: service });
  }
  res.redirect('/admin/services?status=' + encodeURIComponent('Layanan berhasil diperbarui.'));
});

app.delete('/admin/services/:id', requireAuth, requireRole('admin'), (req, res) => {
  const serviceId = parseInt(req.params.id, 10);
  const idx = db.services.findIndex((s) => s.id === serviceId);
  if (idx !== -1) {
    db.services.splice(idx, 1);
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Layanan berhasil dihapus.' });
  }
  res.redirect('/admin/services?status=' + encodeURIComponent('Layanan berhasil dihapus.'));
});

// Admin Users (Manajemen User)
app.get('/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  res.render('admin/users', {
    status: req.query.status || null,
    error: req.query.error || null,
  });
});

// DataTables Server-Side endpoint for Users
app.get('/admin/users/dt', requireAuth, requireRole('admin'), (req, res) => {
  const draw = parseInt(req.query.draw, 10) || 1;
  const start = parseInt(req.query.start, 10) || 0;
  const length = parseInt(req.query.length, 10) || 10;
  const searchVal = (req.query.search && req.query.search.value) ? req.query.search.value.toLowerCase().trim() : '';

  let list = db.users.slice();
  const recordsTotal = list.length;

  if (searchVal) {
    list = list.filter((u) => {
      const matchName = (u.name || '').toLowerCase().includes(searchVal);
      const matchEmail = (u.email || '').toLowerCase().includes(searchVal);
      const matchRole = (u.role || '').toLowerCase().includes(searchVal);
      return matchName || matchEmail || matchRole;
    });
  }

  const orderColIdx = req.query.order && req.query.order[0] ? parseInt(req.query.order[0].column, 10) : 0;
  const orderDir = req.query.order && req.query.order[0] && req.query.order[0].dir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    if (orderColIdx === 0) return (a.name || '').localeCompare(b.name || '') * orderDir;
    if (orderColIdx === 1) return (a.email || '').localeCompare(b.email || '') * orderDir;
    if (orderColIdx === 2) return (a.role || '').localeCompare(b.role || '') * orderDir;
    return ((a.id || 0) - (b.id || 0)) * orderDir;
  });

  const recordsFiltered = list.length;
  const paged = list.slice(start, start + length);

  const data = paged.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
  }));

  res.json({
    draw,
    recordsTotal,
    recordsFiltered,
    data,
  });
});

// Tambah User
app.post('/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: 'Nama, email, dan password wajib diisi.' });
    }
    return res.redirect('/admin/users?error=' + encodeURIComponent('Nama, email, dan password wajib diisi.'));
  }

  const emailTrimmed = email.trim().toLowerCase();
  const existing = db.users.find((u) => u.email.toLowerCase() === emailTrimmed);
  if (existing) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: 'Email sudah terdaftar. Gunakan email lain.' });
    }
    return res.redirect('/admin/users?error=' + encodeURIComponent('Email sudah terdaftar.'));
  }

  const newUser = {
    id: db.nextUserId++,
    name: name.trim(),
    email: emailTrimmed,
    password: password.trim(),
    role: (role === 'admin' ? 'admin' : 'operator'),
  };
  db.users.push(newUser);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'User berhasil ditambahkan.', data: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role } });
  }
  res.redirect('/admin/users?status=' + encodeURIComponent('User berhasil ditambahkan.'));
});

// Edit User
app.put('/admin/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
    }
    return res.redirect('/admin/users?error=' + encodeURIComponent('User tidak ditemukan.'));
  }

  const { name, email, password, role } = req.body;
  if (email) {
    const emailTrimmed = email.trim().toLowerCase();
    const existing = db.users.find((u) => u.email.toLowerCase() === emailTrimmed && u.id !== userId);
    if (existing) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, message: 'Email sudah digunakan oleh akun lain.' });
      }
      return res.redirect('/admin/users?error=' + encodeURIComponent('Email sudah digunakan oleh akun lain.'));
    }
    user.email = emailTrimmed;
  }

  if (name) user.name = name.trim();
  if (password && password.trim()) user.password = password.trim();
  if (role) user.role = (role === 'admin' ? 'admin' : 'operator');

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'User berhasil diperbarui.', data: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }
  res.redirect('/admin/users?status=' + encodeURIComponent('User berhasil diperbarui.'));
});

// Hapus User
app.delete('/admin/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id, 10);
  // Lindungi user yang sedang login agar tidak terhapus sendiri
  if (req.user && req.user.id === userId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, message: 'Anda tidak dapat menghapus akun yang sedang aktif digunakan.' });
    }
    return res.redirect('/admin/users?error=' + encodeURIComponent('Tidak dapat menghapus akun sendiri.'));
  }

  const idx = db.users.findIndex((u) => u.id === userId);
  if (idx !== -1) {
    db.users.splice(idx, 1);
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'User berhasil dihapus.' });
  }
  res.redirect('/admin/users?status=' + encodeURIComponent('User berhasil dihapus.'));
});

// Admin Display Settings
app.get('/admin/display-settings', requireAuth, requireRole('admin'), (req, res) => {
  res.render('admin/display-settings', {
    settings: db.displaySettings,
    status: req.query.status || null,
    error: req.query.error || null,
  });
});

app.put('/admin/display-settings', requireAuth, requireRole('admin'), upload.single('video_file'), (req, res) => {
  const { company_name, tagline, running_text, video_url, remove_video } = req.body;

  if (company_name) db.displaySettings.company_name = company_name.trim();
  if (tagline !== undefined) db.displaySettings.tagline = tagline.trim();
  if (running_text) db.displaySettings.running_text = running_text.trim();
  if (video_url !== undefined) db.displaySettings.video_url = video_url.trim();

  if (req.file) {
    db.displaySettings.video_path = '/uploads/' + req.file.filename;
  } else if (remove_video === '1') {
    db.displaySettings.video_path = '';
    db.displaySettings.video_url = '';
  }

  res.redirect('/admin/display-settings?status=' + encodeURIComponent('Pengaturan display berhasil disimpan.'));
});

// Admin Reports
app.get('/admin/reports', requireAuth, requireRole('admin'), (req, res) => {
  const from = req.query.from || getTodayString();
  const to = req.query.to || getTodayString();

  const filteredTickets = db.tickets.filter((t) => t.queue_date >= from && t.queue_date <= to);

  const summary = {
    total: filteredTickets.length,
    done: filteredTickets.filter((t) => t.status === 'done').length,
    skipped: filteredTickets.filter((t) => t.status === 'skipped').length,
    waiting: filteredTickets.filter((t) => t.status === 'waiting').length,
    serving: filteredTickets.filter((t) => ['called', 'serving'].includes(t.status)).length,
  };

  // Average service duration in minutes for done tickets
  const doneTickets = filteredTickets.filter((t) => t.status === 'done' && t.served_at && t.finished_at);
  let avgServeMinutes = null;
  if (doneTickets.length > 0) {
    const totalMinutes = doneTickets.reduce((sum, t) => {
      const diff = (new Date(t.finished_at).getTime() - new Date(t.served_at).getTime()) / 60000;
      return sum + Math.max(0, diff);
    }, 0);
    avgServeMinutes = totalMinutes / doneTickets.length;
  }

  // Per service breakdown
  const perServiceMap = {};
  for (const s of db.services) {
    perServiceMap[s.id] = { service: s.name, total: 0, done: 0, skipped: 0 };
  }
  for (const t of filteredTickets) {
    if (!perServiceMap[t.service_id]) {
      perServiceMap[t.service_id] = { service: 'Layanan #' + t.service_id, total: 0, done: 0, skipped: 0 };
    }
    perServiceMap[t.service_id].total++;
    if (t.status === 'done') perServiceMap[t.service_id].done++;
    if (t.status === 'skipped') perServiceMap[t.service_id].skipped++;
  }
  const perService = Object.values(perServiceMap).filter((r) => r.total > 0);

  // Per counter breakdown
  const perCounterMap = {};
  for (const c of db.counters) {
    perCounterMap[c.id] = { counter: c.name, total: 0, done: 0 };
  }
  for (const t of filteredTickets) {
    if (t.counter_id) {
      if (!perCounterMap[t.counter_id]) {
        perCounterMap[t.counter_id] = { counter: 'Loket #' + t.counter_id, total: 0, done: 0 };
      }
      perCounterMap[t.counter_id].total++;
      if (t.status === 'done') perCounterMap[t.counter_id].done++;
    }
  }
  const perCounter = Object.values(perCounterMap).filter((r) => r.total > 0);

  // Daily trends
  const dailyMap = {};
  for (const t of filteredTickets) {
    if (!dailyMap[t.queue_date]) {
      dailyMap[t.queue_date] = { queue_date: t.queue_date, total: 0, done: 0 };
    }
    dailyMap[t.queue_date].total++;
    if (t.status === 'done') dailyMap[t.queue_date].done++;
  }
  const daily = Object.values(dailyMap).sort((a, b) => b.queue_date.localeCompare(a.queue_date));

  res.render('admin/reports', {
    from,
    to,
    summary,
    avgServeMinutes,
    perService,
    perCounter,
    daily,
  });
});

// DataTables Server-Side endpoint for tickets list in reports
app.get('/admin/reports/dt', requireAuth, requireRole('admin'), (req, res) => {
  const draw = parseInt(req.query.draw, 10) || 1;
  const start = parseInt(req.query.start, 10) || 0;
  const length = parseInt(req.query.length, 10) || 10;
  const searchVal = (req.query.search && req.query.search.value) ? req.query.search.value.toLowerCase().trim() : '';
  const from = req.query.from || getTodayString();
  const to = req.query.to || getTodayString();

  let list = db.tickets.filter((t) => t.queue_date >= from && t.queue_date <= to);
  const recordsTotal = list.length;

  if (searchVal) {
    list = list.filter((t) => {
      const s = db.services.find((item) => item.id === t.service_id);
      const c = db.counters.find((item) => item.id === t.counter_id);
      const matchCode = (t.code || '').toLowerCase().includes(searchVal);
      const matchStatus = (t.status || '').toLowerCase().includes(searchVal);
      const matchSvc = (s?.name || '').toLowerCase().includes(searchVal);
      const matchCounter = (c?.name || '').toLowerCase().includes(searchVal);
      return matchCode || matchStatus || matchSvc || matchCounter;
    });
  }

  const orderColIdx = req.query.order && req.query.order[0] ? parseInt(req.query.order[0].column, 10) : 0;
  const orderDir = req.query.order && req.query.order[0] && req.query.order[0].dir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    if (orderColIdx === 0) return ((a.id || 0) - (b.id || 0)) * orderDir;
    if (orderColIdx === 1) return (a.code || '').localeCompare(b.code || '') * orderDir;
    if (orderColIdx === 3) return (a.status || '').localeCompare(b.status || '') * orderDir;
    return (new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()) * orderDir;
  });

  const recordsFiltered = list.length;
  const paged = list.slice(start, start + length);

  const data = paged.map((t) => {
    const s = db.services.find((item) => item.id === t.service_id);
    const c = db.counters.find((item) => item.id === t.counter_id);
    return {
      id: t.id,
      code: t.code,
      service: s ? s.name : '-',
      counter: c ? c.name : '-',
      status: t.status,
      queue_date: t.queue_date,
      created_at: t.created_at ? new Date(t.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-',
      called_at: t.called_at ? new Date(t.called_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-',
      finished_at: t.finished_at ? new Date(t.finished_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-',
    };
  });

  res.json({
    draw,
    recordsTotal,
    recordsFiltered,
    data,
  });
});

app.get('/admin/reports/export', requireAuth, requireRole('admin'), (req, res) => {
  const from = req.query.from || getTodayString();
  const to = req.query.to || getTodayString();

  const filteredTickets = db.tickets.filter((t) => t.queue_date >= from && t.queue_date <= to);

  let csv = 'Kode,Layanan,Loket,Status,Tanggal,Waktu Buat,Waktu Panggil,Waktu Selesai\n';
  for (const t of filteredTickets) {
    const s = db.services.find((item) => item.id === t.service_id);
    const c = db.counters.find((item) => item.id === t.counter_id);
    const row = [
      t.code,
      `"${s?.name || ''}"`,
      `"${c?.name || ''}"`,
      t.status,
      t.queue_date,
      t.created_at ? new Date(t.created_at).toISOString() : '',
      t.called_at ? new Date(t.called_at).toISOString() : '',
      t.finished_at ? new Date(t.finished_at).toISOString() : '',
    ];
    csv += row.join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="laporan-antrian-${from}-to-${to}.csv"`);
  res.send(csv);
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
