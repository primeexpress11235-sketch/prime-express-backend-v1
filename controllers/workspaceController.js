import asyncHandler from 'express-async-handler';
import Note from '../models/Note.js';

// Notes
const getNotes = asyncHandler(async (req, res) => {
  const query = { $or: [{ user: req.user._id }, { user: null }, { user: { $exists: false } }] };
  const notes = await Note.find(query).sort({ updatedAt: -1 });
  const mapped = notes.map((n) => ({ ...n.toObject(), id: n._id }));
  res.json(mapped);
});

const createNote = asyncHandler(async (req, res) => {
  const { title = 'Untitled', content = '' } = req.body;
  const note = await Note.create({ user: req.user._id, title, content });
  res.status(201).json({ ...note.toObject(), id: note._id });
});

const updateNote = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const note = await Note.findByIdAndUpdate(id, updates, { new: true });
  if (!note) return res.status(404).json({ message: 'Note not found' });
  res.json({ ...note.toObject(), id: note._id });
});

const deleteNote = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const note = await Note.findByIdAndDelete(id);
  if (!note) return res.status(404).json({ message: 'Note not found' });
  res.json({ message: 'Deleted' });
});

export { getNotes, createNote, updateNote, deleteNote };
