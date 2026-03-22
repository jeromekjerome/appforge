import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { sql, initDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Auth ─────────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Interview proxy ──────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, context } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'messages required' });

  const contextNote = context === 'professional'
    ? 'This person has a professional context (could be medical, business, legal, tech, etc.).'
    : 'This person is describing a personal or everyday life pain point.';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: `You are AppForge, an empathetic and brilliant product analyst who helps people articulate their ideas into buildable apps.

Your job: Interview the user about their pain point to gather enough information to write a detailed spec for Claude Code to build a custom app for them.

${contextNote}

Rules:
- Be warm, curious, and encouraging — this might be someone who has never thought about building software
- Ask ONE focused question at a time, never more
- Explore: what exactly the pain is, how often it happens, what they do now as a workaround, what ideal success looks like, who else might be affected or use this
- Probe gently for specifics: numbers, frequency, edge cases
- After 4–6 exchanges where you have enough to write a solid spec, tell them you have everything you need and set readyToGenerate to true
- Keep messages SHORT — 2 to 3 sentences maximum
- Be encouraging — remind them that their domain knowledge IS the expertise; you'll handle the technical translation
- ALWAYS respond with valid JSON only, no preamble, no markdown fences:
  {"message": "your response here", "readyToGenerate": false}`,
      messages
    });
    res.json({ text: response.content[0].text });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Spec generation ──────────────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { messages, context } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'messages required' });

  const contextNote = context === 'professional' ? 'professional' : 'personal';
  const transcript = messages.map(m =>
    `${m.role === 'user' ? 'User' : 'AppForge'}: ${m.content}`
  ).join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2500,
      system: `You are AppForge. Based on a user interview about their pain point, generate a comprehensive Claude Code app spec in Markdown.

This is a ${contextNote} use case.

Structure the spec exactly as follows:

# [App Name]
> [One-line description]

## Problem statement
[2-3 sentences on the core problem, written from the user's perspective]

## Core features
[Prioritized list — MVP features first, "nice to have" clearly labeled]

## User experience
[How should the app feel? Key UX decisions, flows, any special considerations]

## Technical requirements
[Stack suggestions, data persistence, APIs if needed, platform (web/mobile/desktop)]

## Data model
[Key data structures, what gets stored, relationships if any]

## Edge cases & constraints
[Things to handle carefully, error states, privacy considerations]

## Success criteria
[How will the user know this app solved the problem? Measurable outcomes]

---

## Claude Code build prompt

> Paste everything below this line directly into Claude Code to begin building.

\`\`\`
[Write a complete, detailed, self-contained prompt for Claude Code. Include all context from the interview. Be specific about every feature. Include the tech stack, file structure expectations, and any domain-specific requirements the user mentioned. This should be ready to paste and build without additional clarification.]
\`\`\`

Be specific and actionable throughout. No vague requirements — this is a build spec, not a wishlist.`,
      messages: [{ role: 'user', content: `Interview transcript:\n\n${transcript}\n\nGenerate the complete app spec.` }]
    });
    res.json({ spec: response.content[0].text });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Lead capture ─────────────────────────────────────────────────────────────
app.post('/api/leads', async (req, res) => {
  const { name, email, context, specMarkdown, transcript } = req.body;
  if (!email || !specMarkdown) return res.status(400).json({ error: 'email and specMarkdown required' });

  try {
    const [lead] = await sql`
      INSERT INTO leads (name, email, context, spec_markdown, transcript)
      VALUES (${name || null}, ${email}, ${context || 'personal'}, ${specMarkdown}, ${JSON.stringify(transcript || [])})
      RETURNING id, created_at
    `;
    notifyAdmin(lead.id, name, email, specMarkdown).catch(console.error);
    res.json({ ok: true, leadId: lead.id });
  } catch (err) {
    console.error('Lead capture error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function notifyAdmin(leadId, name, email, spec) {
  if (!process.env.SMTP_HOST) return;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.NOTIFICATION_EMAIL,
    subject: `New AppForge Lead: ${name || email}`,
    text: `New build request from ${name || 'anonymous'} (${email})\n\nSpec preview:\n${spec.slice(0, 500)}...\n\nView in admin: ${process.env.APP_URL}/admin`
  });
}

// ─── Admin ────────────────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/leads', requireAdmin, async (req, res) => {
  try {
    const leads = await sql`
      SELECT id, name, email, context, status, notes, created_at,
             LEFT(spec_markdown, 300) AS spec_preview
      FROM leads ORDER BY created_at DESC
    `;
    res.json(leads);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/leads/:id', requireAdmin, async (req, res) => {
  try {
    const [lead] = await sql`SELECT * FROM leads WHERE id = ${req.params.id}`;
    if (!lead) return res.status(404).json({ error: 'Not found' });
    res.json(lead);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/admin/leads/:id', requireAdmin, async (req, res) => {
  const { status, notes } = req.body;
  try {
    const [lead] = await sql`
      UPDATE leads SET
        status     = COALESCE(${status || null}, status),
        notes      = COALESCE(${notes !== undefined ? notes : null}, notes),
        updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    res.json(lead);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3005;
initDb().then(() => {
  app.listen(PORT, () => console.log(`AppForge running on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
