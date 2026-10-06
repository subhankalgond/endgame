import { randomBytes, randomInt } from 'node:crypto';
import { db, nowMs, audit, flushAudit } from './db';
import { hashPassword } from './lib/password';
import { recordJoinToken } from './tokens';
import { config } from './config';

/** The exact Round 1 team tokens from the event specification. Do not change. */
export const TEAM_TOKENS: Record<number, string[]> = {
  1: ['7k4', '0a', '8x', '72'],
  2: ['x82', '7a', '04', 'k7'],
  3: ['a07', '4x', 'k2', '87'],
  4: ['2k8', 'x7', 'a4', '07'],
  5: ['47x', '8k', '02', 'a7'],
  6: ['k70', '2a', '78', 'x4'],
  7: ['8a7', 'k4', '2x', '70'],
  8: ['0x4', '7k', 'a8', '27'],
};

interface PuzzleSeed {
  question: string;
  answer: string;
  alts: string[];
  difficulty: string;
  explanation: string;
}

/** 32 default puzzles: 4 distinct puzzles per team, ~70% easy / 30% medium-easy. */
const PUZZLES: Record<number, PuzzleSeed[]> = {
  1: [
    { question: 'What number comes next? 2, 4, 6, 8, ?', answer: '10', alts: [], difficulty: 'easy', explanation: 'Counting even numbers, each step adds 2.' },
    { question: 'I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?', answer: 'echo', alts: ['an echo'], difficulty: 'easy', explanation: 'Classic riddle: an echo.' },
    { question: 'If all Bloops are Razzies and all Razzies are Lazzies, are all Bloops definitely Lazzies?', answer: 'yes', alts: ['yes they are', 'yes, they are'], difficulty: 'easy', explanation: 'Transitive logic: Bloops -> Razzies -> Lazzies.' },
    { question: 'What 5-letter word becomes shorter when you add two letters to it?', answer: 'short', alts: [], difficulty: 'easy', explanation: 'Adding "er" makes "shorter", which means shorter.' },
  ],
  2: [
    { question: 'What number comes next? 5, 10, 15, 20, ?', answer: '25', alts: [], difficulty: 'easy', explanation: 'Multiples of 5.' },
    { question: 'What has hands but cannot clap?', answer: 'clock', alts: ['a clock'], difficulty: 'easy', explanation: 'A clock has hands.' },
    { question: 'A farmer has 17 sheep. All but 9 run away. How many sheep are left?', answer: '9', alts: [], difficulty: 'easy', explanation: '"All but 9" means 9 remain.' },
    { question: 'Rearrange the letters L-I-S-T-E-N to form a 6-letter word meaning to keep quiet and pay attention.', answer: 'silent', alts: [], difficulty: 'easy', explanation: 'LISTEN is an anagram of SILENT.' },
  ],
  3: [
    { question: 'What number comes next? 3, 6, 9, 12, ?', answer: '15', alts: [], difficulty: 'easy', explanation: 'Counting in 3s.' },
    { question: 'What has keys but cannot open locks?', answer: 'piano', alts: ['a piano'], difficulty: 'easy', explanation: 'A piano has keys.' },
    { question: 'What 7-letter palindrome is shaped like a fast racing vehicle?', answer: 'racecar', alts: [], difficulty: 'medium-easy', explanation: 'RACECAR reads the same backwards.' },
    { question: 'Which weighs more: 1 kg of feathers or 1 kg of bricks?', answer: 'same', alts: ['equal', 'neither', 'both', 'both the same', 'they weigh the same', 'neither they weigh the same'], difficulty: 'easy', explanation: 'Both weigh exactly 1 kg.' },
  ],
  4: [
    { question: 'What number comes next? 1, 4, 9, 16, ?', answer: '25', alts: [], difficulty: 'medium-easy', explanation: 'Square numbers: 1, 4, 9, 16, 25.' },
    { question: 'The more you take, the more you leave behind. What are they?', answer: 'footsteps', alts: ['steps', 'footstep'], difficulty: 'easy', explanation: 'Every step you take leaves a footprint.' },
    { question: 'If you have 3 apples and give away 2, how many apples do you have left?', answer: '1', alts: [], difficulty: 'easy', explanation: '3 - 2 = 1.' },
    { question: 'How many letters are in the word "ALPHABET"?', answer: '8', alts: ['eight'], difficulty: 'easy', explanation: 'A-L-P-H-A-B-E-T = 8 letters.' },
  ],
  5: [
    { question: 'What number comes next? 2, 3, 5, 7, 11, ?', answer: '13', alts: [], difficulty: 'medium-easy', explanation: 'Prime numbers.' },
    { question: 'What gets wetter the more it dries?', answer: 'towel', alts: ['a towel'], difficulty: 'easy', explanation: 'A towel absorbs water as it dries things.' },
    { question: 'Today is Monday. What day of the week will it be after 3 days?', answer: 'thursday', alts: ['thu', 'thur', 'thurs'], difficulty: 'easy', explanation: 'Mon + 3 = Thursday.' },
    { question: 'Unscramble the letters H-C-A-E-T to make a 5-letter word meaning to show someone something.', answer: 'teach', alts: ['cheat'], difficulty: 'easy', explanation: 'HCAET rearranges to TEACH (CHEAT also fits).' },
  ],
  6: [
    { question: 'What number comes next? 40, 35, 30, 25, ?', answer: '20', alts: [], difficulty: 'easy', explanation: 'Counting down by 5.' },
    { question: 'What can you catch but cannot throw?', answer: 'cold', alts: ['a cold'], difficulty: 'easy', explanation: 'You catch a cold.' },
    { question: 'Which number is both even and a multiple of 3? 3, 5, 6, 7', answer: '6', alts: ['six'], difficulty: 'easy', explanation: '6 is even and divisible by 3.' },
    { question: 'Which letter of the alphabet comes immediately after K?', answer: 'l', alts: ['el'], difficulty: 'easy', explanation: '... J, K, L ...' },
  ],
  7: [
    { question: 'What number comes next? 2, 6, 18, 54, ?', answer: '162', alts: [], difficulty: 'medium-easy', explanation: 'Each number is multiplied by 3.' },
    { question: 'I have cities but no houses, mountains but no trees, and water but no fish. What am I?', answer: 'map', alts: ['a map'], difficulty: 'easy', explanation: 'A map shows those features.' },
    { question: 'It takes 5 machines 5 minutes to make 5 widgets. How many minutes do 100 machines need to make 100 widgets?', answer: '5', alts: ['five', '5 minutes'], difficulty: 'medium-easy', explanation: 'Each machine takes 5 minutes per widget.' },
    { question: 'How many times does the letter E appear in the word SEVEN?', answer: '2', alts: ['two'], difficulty: 'easy', explanation: 'S-E-V-E-N has two E letters.' },
  ],
  8: [
    { question: 'What number comes next? 100, 90, 80, 70, ?', answer: '60', alts: [], difficulty: 'easy', explanation: 'Counting down by 10.' },
    { question: 'What has a neck but no head?', answer: 'bottle', alts: ['a bottle'], difficulty: 'easy', explanation: 'A bottle has a neck.' },
    { question: 'Mary is taller than Tom. Tom is taller than Sara. Who is the shortest?', answer: 'sara', alts: ['Sara'], difficulty: 'easy', explanation: 'Sara is shortest of the three.' },
    { question: 'Unscramble P-S-O-T to make a 4-letter word meaning to halt.', answer: 'stop', alts: [], difficulty: 'easy', explanation: 'PSOT rearranges to STOP.' },
  ],
};

export function newJoinToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Default correct order: tokens are intentionally stored shuffled relative to player order. */
function defaultSequence(tokens: string[]): string {
  return JSON.stringify([tokens[2], tokens[0], tokens[3], tokens[1]]);
}

export async function seedDatabase(): Promise<void> {
  const now = nowMs();

  const existingTeams = (await db.prepare('SELECT COUNT(*) AS c FROM teams').get() as { c: number }).c;
  if (existingTeams === 0) {
    const insertTeam = await db.prepare(
      'INSERT INTO teams (id, name, join_token, correct_sequence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (let i = 1; i <= 8; i += 1) {
      await insertTeam.run(i, `Team ${i}`, newJoinToken(), defaultSequence(TEAM_TOKENS[i]), now, now);
      await db.prepare('INSERT INTO team_results (team_id, updated_at) VALUES (?, ?) ON CONFLICT DO NOTHING').run(i, now);
    }
    audit('seed_teams_created', 'system', { detail: { teams: 8 } });
  }

  for (let i = 1; i <= 8; i += 1) {
    await db.prepare('INSERT INTO team_results (team_id, updated_at) VALUES (?, ?) ON CONFLICT DO NOTHING').run(i, now);
    const count = (await db.prepare('SELECT COUNT(*) AS c FROM puzzles WHERE team_id = ?').get(i) as { c: number }).c;
    if (count === 0) {
      const tokens = TEAM_TOKENS[i];
      const insertPuzzle = await db.prepare(
        `INSERT INTO puzzles (team_id, slot, question, answer, alt_answers, reward_token, difficulty, explanation, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [idx, p] of PUZZLES[i].entries()) {
        await insertPuzzle.run(i, idx + 1, p.question, p.answer, JSON.stringify(p.alts), tokens[idx], p.difficulty, p.explanation, now);
      }
    }
  }

  // Mirror the four reward tokens per team and register the active QR join token.
  const mirror = await db.prepare(
    `INSERT INTO team_tokens (team_id, slot, reward_token, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(team_id, slot) DO UPDATE SET reward_token = excluded.reward_token, updated_at = excluded.updated_at`,
  );
  const teams = await db.prepare('SELECT id, join_token FROM teams').all() as { id: number; join_token: string }[];
  for (const team of teams) {
    const tokens = await db
      .prepare('SELECT slot, reward_token FROM puzzles WHERE team_id = ? ORDER BY slot')
      .all(team.id) as { slot: number; reward_token: string }[];
    for (const row of tokens) await mirror.run(team.id, row.slot, row.reward_token, now);
    await recordJoinToken(team.id, team.join_token, { revokePrevious: false });
  }

  const round = await db.prepare('SELECT id FROM rounds WHERE id = 1').get();
  if (!round) {
    await db.prepare(
      'INSERT INTO rounds (id, state, duration_sec, updated_at) VALUES (1, ?, ?, ?)',
    ).run('WAITING', config.roundDurationSec, now);
  }

  const adminCount = (await db.prepare('SELECT COUNT(*) AS c FROM admins').get() as { c: number }).c;
  if (adminCount === 0) {
    let password = config.adminPassword;
    let generated = false;
    if (!password) {
      if (config.isProduction) {
        throw new Error('ADMIN_PASSWORD must be set in production');
      }
      password = randomBytes(9).toString('base64url');
      generated = true;
    }
    await db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)').run(
      config.adminUsername,
      hashPassword(password),
      now,
    );
    audit('admin_seeded', 'system', { detail: { username: config.adminUsername } });
    await flushAudit();
    if (generated) {
      console.warn(`[endgame] No ADMIN_PASSWORD set. Generated one-time admin password: ${password}`);
    }
  }

  void randomInt;
}
