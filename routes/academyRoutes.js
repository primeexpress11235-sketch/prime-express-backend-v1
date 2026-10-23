import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { uploadDocument, uploadImage } from '../middleware/uploadMiddleware.js';
import {
  getChapters,
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  createChapter,
  updateChapter,
  deleteChapter,
  getQuizByChapter,
  upsertQuiz,
  submitQuiz,
  getMyProgress,
  getAdminAgentProgress,
  getTrainingContent,
  createTrainingContent,
  updateTrainingContent,
  uploadTrainingDocument,
  downloadTrainingDocument,
  deleteTrainingContent,
  getTruckTypes,
  createTruckType,
  updateTruckType,
  deleteTruckType,
  askQuestion,
  getMyQuestions,
  getFAQ,
  getAdminQuestions,
  replyQuestion,
  searchAcademy,
  uploadAcademyImage,
} from '../controllers/academyController.js';

const router = express.Router();

// Apply protect middleware to all academy routes
router.use(protect);

// ─── Image Upload ───
router.post('/upload-image', adminOnly, uploadImage.single('image'), uploadAcademyImage);

// ─── Search ───
router.get('/search', searchAcademy);

// ─── Chapters ───
router.get('/courses', getCourses);
router.post('/courses', adminOnly, createCourse);
router.put('/courses/:id', adminOnly, updateCourse);
router.delete('/courses/:id', adminOnly, deleteCourse);

router.get('/chapters', getChapters);
router.post('/chapters', adminOnly, createChapter);
router.put('/chapters/:id', adminOnly, updateChapter);
router.delete('/chapters/:id', adminOnly, deleteChapter);

// ─── Quizzes & Attempts ───
router.get('/quizzes/chapter/:chapterId', getQuizByChapter);
router.post('/quizzes', adminOnly, upsertQuiz);
router.post('/quizzes/submit', submitQuiz);

// ─── Progress Overviews ───
router.get('/progress', getMyProgress);
router.get('/admin/agent-progress', adminOnly, getAdminAgentProgress);

// ─── Training Content ───
router.get('/training-content', getTrainingContent);
router.post('/training-content', adminOnly, createTrainingContent);
router.put('/training-content/:id', adminOnly, updateTrainingContent);
router.post(
  '/training-content/:id/document',
  adminOnly,
  uploadDocument.single('document'),
  uploadTrainingDocument
);
router.get('/training-content/:id/document/download', downloadTrainingDocument);
router.delete('/training-content/:id', adminOnly, deleteTrainingContent);

// ─── Truck Types ───
router.get('/truck-types', getTruckTypes);
router.post('/truck-types', adminOnly, createTruckType);
router.put('/truck-types/:id', adminOnly, updateTruckType);
router.delete('/truck-types/:id', adminOnly, deleteTruckType);

// ─── Q&A and FAQ ───
router.post('/questions', askQuestion);
router.get('/questions/my', getMyQuestions);
router.get('/questions/faq', getFAQ);
router.get('/questions/admin', adminOnly, getAdminQuestions);
router.put('/questions/admin/:id/reply', adminOnly, replyQuestion);

export default router;
