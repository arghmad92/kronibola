/**
 * Formation definitions for the 3-team 11-a-side builder.
 *
 * Shared by the Worker (register.js — slot validation) and the homepage
 * (index.astro imports this at build time to render the pitches).
 *
 * Coordinates are % of the pitch: x 0=left 100=right,
 * y 0=attacking third 100=own goal.
 *
 * Adding a formation = one entry in FORMATIONS. v1 only ships 4-3-3;
 * DEFAULT_FORMATION is the fallback when a session doesn't specify one.
 */

export const FORMATIONS = {
  '4-3-3': [
    { id: 'GK',  label: 'GK', full: 'Goalkeeper',  x: 50, y: 90 },
    { id: 'LB',  label: 'LB', full: 'Left Back',   x: 16, y: 70 },
    { id: 'LCB', label: 'CB', full: 'Centre Back', x: 38, y: 77 },
    { id: 'RCB', label: 'CB', full: 'Centre Back', x: 62, y: 77 },
    { id: 'RB',  label: 'RB', full: 'Right Back',  x: 84, y: 70 },
    { id: 'LCM', label: 'CM', full: 'Centre Mid',  x: 27, y: 50 },
    { id: 'CM',  label: 'CM', full: 'Centre Mid',  x: 50, y: 54 },
    { id: 'RCM', label: 'CM', full: 'Centre Mid',  x: 73, y: 50 },
    { id: 'LW',  label: 'LW', full: 'Left Wing',   x: 20, y: 23 },
    { id: 'ST',  label: 'ST', full: 'Striker',     x: 50, y: 16 },
    { id: 'RW',  label: 'RW', full: 'Right Wing',  x: 80, y: 23 },
  ],
};

export const DEFAULT_FORMATION = '4-3-3';
// Value of the Sessions sheet `Format` column that turns on the team builder.
export const TEAM_GAME_FORMAT = '3-team-11';
export const TEAMS = ['A', 'B', 'C'];

// Statuses that count as "occupying" a slot. Rejected frees the slot back
// up; Waitlist isn't used for team games (each slot is a hard 1-of-1).
export const SLOT_OCCUPYING_STATUSES = ['Paid', 'Pending', 'Overdue'];

export function getFormation(name) {
  return FORMATIONS[name] || FORMATIONS[DEFAULT_FORMATION];
}

// Is this session configured as a 3-team 11-a-side game?
export function isTeamGame(session) {
  return !!session && String(session.Format || '').trim() === TEAM_GAME_FORMAT;
}

// Is (team, position) a real slot for the given formation?
export function isValidSlot(formationName, team, position) {
  if (!TEAMS.includes(String(team))) return false;
  return getFormation(formationName).some((p) => p.id === String(position));
}
