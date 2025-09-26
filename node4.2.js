// app.js
// REST API for Playing Card Collection using Express.js
// Run: node app.js

const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// In-memory cards collection
let cards = [
  { id: 1, suit: "Hearts", value: "Ace" },
  { id: 2, suit: "Spades", value: "King" },
  { id: 3, suit: "Diamonds", value: "Queen" },
];

// Auto-increment ID counter
let nextId = cards.length + 1;

// ✅ GET all cards
app.get('/cards', (req, res) => {
  res.json(cards);
});

// ✅ GET card by ID
app.get('/cards/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const card = cards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ message: `Card with ID ${id} not found.` });
  }
  res.json(card);
});

// ✅ POST add new card
app.post('/cards', (req, res) => {
  const { suit, value } = req.body;

  if (!suit || !value) {
    return res.status(400).json({ message: "Both 'suit' and 'value' are required." });
  }

  const newCard = {
    id: nextId++,
    suit,
    value
  };
  cards.push(newCard);

  res.status(201).json(newCard);
});

// ✅ DELETE card by ID
app.delete('/cards/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = cards.findIndex(c => c.id === id);

  if (index === -1) {
    return res.status(404).json({ message: `Card with ID ${id} not found.` });
  }

  const removedCard = cards.splice(index, 1)[0];
  res.json({ message: `Card with ID ${id} removed.`, card: removedCard });
});

// Health check
app.get('/', (req, res) => {
  res.send('Playing Card Collection API is running.');
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});