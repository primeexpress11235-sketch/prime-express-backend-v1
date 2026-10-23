import mongoose from 'mongoose';

const NoteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, default: 'Untitled' },
    content: { type: String, default: '' },
  },
  { timestamps: true }
);

const Note = mongoose.model('Note', NoteSchema);
export default Note;
