

const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Configuration
const PORT = process.env.PORT || 3000;
const LOCK_TTL_MS = 60 * 1000; // 1 minute lock expiry

// Seats store (in-memory).
// Structure:
// seats = {
//   "1": { status: "available" | "locked" | "booked",
//          lockOwner: "userId" | null,
//          lockExpiresAt: timestamp | null,
//          timer: TimeoutObject | null }
// }
const seats = {};

// initialize seats - change COUNT as needed
const SEAT_COUNT = 10;
for (let i = 1; i <= SEAT_COUNT; i++) {
  seats[i] = {
    status: 'available',
    lockOwner: null,
    lockExpiresAt: null,
    timer: null,
  };
}

/**
 * Internal helper: release lock on a seat (used on expiry or explicit unlock)
 * Clears timer, resets fields, and sets status back to 'available' only if current status is 'locked'.
 */
function releaseLock(seatId) {
  const s = seats[seatId];
  if (!s) return;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  // Only change if seat is still locked (avoid overwriting a booked seat)
  if (s.status === 'locked') {
    s.status = 'available';
    s.lockOwner = null;
    s.lockExpiresAt = null;
  }
}

/**
 * Lock a seat for a user
 * - If seat is available => set to locked, schedule expiry
 * - If seat is locked or booked => return appropriate error
 */
app.post('/lock/:id', (req, res) => {
  const seatId = req.params.id;
  const userId = req.body?.userId;
  if (!userId) {
    return res.status(400).json({ message: 'Missing userId in request body.' });
  }

  const seat = seats[seatId];
  if (!seat) return res.status(404).json({ message: `Seat ${seatId} not found.` });

  // If seat already booked
  if (seat.status === 'booked') {
    return res.status(400).json({ message: `Seat ${seatId} is already booked.` });
  }

  // If seat already locked
  if (seat.status === 'locked') {
    // Check if lock expired already (edge case where timer failed) - treat as locked unless expired
    const now = Date.now();
    if (seat.lockExpiresAt && seat.lockExpiresAt <= now) {
      // expired: release then continue to lock
      releaseLock(seatId);
    } else {
      return res.status(409).json({ message: `Seat ${seatId} is currently locked by another user.` });
    }
  }

  // Now seat must be available
  if (seat.status !== 'available') {
    return res.status(400).json({ message: `Seat ${seatId} cannot be locked (status: ${seat.status}).` });
  }

  seat.status = 'locked';
  seat.lockOwner = userId;
  seat.lockExpiresAt = Date.now() + LOCK_TTL_MS;

  // Clear any previous timer just in case
  if (seat.timer) {
    clearTimeout(seat.timer);
    seat.timer = null;
  }

  // Set a timer to release the lock automatically
  seat.timer = setTimeout(() => {
    // On expiry, make sure seat still locked (not already booked)
    if (seats[seatId] && seats[seatId].status === 'locked') {
      releaseLock(seatId);
      console.log(`Lock on seat ${seatId} expired and was released automatically.`);
    }
  }, LOCK_TTL_MS);

  return res.json({ message: `Seat ${seatId} locked successfully. Confirm within ${LOCK_TTL_MS / 1000} seconds.`, lockExpiresAt: seat.lockExpiresAt });
});

/**
 * Confirm a booking
 * - Only lock owner can confirm while lock is valid
 * - On confirm: seat status -> booked, clear timer, clear lockOwner and lockExpiresAt
 */
app.post('/confirm/:id', (req, res) => {
  const seatId = req.params.id;
  const userId = req.body?.userId;
  if (!userId) return res.status(400).json({ message: 'Missing userId in request body.' });

  const seat = seats[seatId];
  if (!seat) return res.status(404).json({ message: `Seat ${seatId} not found.` });

  // If already booked
  if (seat.status === 'booked') {
    return res.status(400).json({ message: `Seat ${seatId} is already booked.` });
  }

  // Must be locked
  if (seat.status !== 'locked') {
    return res.status(400).json({ message: `Seat ${seatId} is not locked and cannot be booked.` });
  }

  // Owner check
  if (seat.lockOwner !== userId) {
    return res.status(403).json({ message: `Seat ${seatId} is locked by another user.` });
  }

  // Check lock expiry
  if (!seat.lockExpiresAt || seat.lockExpiresAt <= Date.now()) {
    // lock expired - release and reject
    releaseLock(seatId);
    return res.status(400).json({ message: `Lock on seat ${seatId} has expired.` });
  }

  // All good: book the seat
  if (seat.timer) {
    clearTimeout(seat.timer);
    seat.timer = null;
  }
  seat.status = 'booked';
  seat.lockOwner = null;
  seat.lockExpiresAt = null;

  return res.json({ message: `Seat ${seatId} booked successfully!` });
});

/**
 * Optional: explicit unlock endpoint (owner can release early)
 */
app.post('/unlock/:id', (req, res) => {
  const seatId = req.params.id;
  const userId = req.body?.userId;
  if (!userId) return res.status(400).json({ message: 'Missing userId in request body.' });

  const seat = seats[seatId];
  if (!seat) return res.status(404).json({ message: `Seat ${seatId} not found.` });

  if (seat.status !== 'locked') {
    return res.status(400).json({ message: `Seat ${seatId} is not locked.` });
  }

  if (seat.lockOwner !== userId) {
    return res.status(403).json({ message: `You are not the lock owner of seat ${seatId}.` });
  }

  releaseLock(seatId);
  return res.json({ message: `Lock on seat ${seatId} released by owner.` });
});

/**
 * GET /seats
 * returns all seats & status (available/locked/booked).
 * For locked seats, it hides internal timer but exposes lockOwner and lockExpiresAt for clarity.
 */
app.get('/seats', (req, res) => {
  const out = {};
  Object.entries(seats).forEach(([id, s]) => {
    out[id] = {
      status: s.status,
      lockOwner: s.status === 'locked' ? s.lockOwner : null,
      lockExpiresAt: s.status === 'locked' ? s.lockExpiresAt : null,
    };
  });
  return res.json(out);
});

// health route
app.get('/', (req, res) => res.send('Seat booking service running.'));

// start server
app.listen(PORT, () => {
  console.log(`Seat booking app listening on http://localhost:${PORT}`);
  console.log(`Seats initialised: ${SEAT_COUNT}. Lock TTL: ${LOCK_TTL_MS}ms`);
});
