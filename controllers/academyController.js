import asyncHandler from 'express-async-handler';
import Chapter from '../models/Chapter.js';
import Course from '../models/Course.js';
import Quiz from '../models/Quiz.js';
import QuizAttempt from '../models/QuizAttempt.js';
import Certification from '../models/Certification.js';
import TrainingContent from '../models/TrainingContent.js';
import TruckType from '../models/TruckType.js';
import Question from '../models/Question.js';
import User from '../models/User.js';
import { createNotification } from '../utils/notificationHelper.js';
import { generateSalesAgentCertificate } from '../services/certificateService.js';
import { streamDocDownload } from '../services/cloudinaryDocService.js';

const getCourseForRequest = async (courseId, user) => {
  const filter = user.role === 'admin'
    ? (courseId ? { _id: courseId } : {})
    : (courseId ? { _id: courseId, audience: user.role, isActive: true } : { audience: user.role, isActive: true });
  return Course.findOne(filter).sort({ createdAt: 1 });
};

const getCourseProgress = async (agentId, courseId) => {
  const chapterIds = await Chapter.find({ courseId }).distinct('_id');
  const passedChapterIds = await QuizAttempt.find({
    agentId,
    chapterId: { $in: chapterIds },
    passed: true,
  }).distinct('chapterId');
  const totalChapters = chapterIds.length;
  const chaptersPassed = passedChapterIds.length;
  return {
    chaptersPassed,
    totalChapters,
    completionPercentage: totalChapters ? Math.round((chaptersPassed / totalChapters) * 100) : 0,
    passedChapterIds,
    isComplete: totalChapters > 0 && chaptersPassed >= totalChapters,
  };
};

// ─── COURSES ───

export const getCourses = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { audience: req.user.role, isActive: true };
  const courses = await Course.find(filter).sort({ createdAt: 1 }).lean();
  res.json({ success: true, data: courses });
});

export const createCourse = asyncHandler(async (req, res) => {
  const { title, description, audience } = req.body;
  const course = await Course.create({ title, description, audience });
  res.status(201).json({ success: true, data: course });
});

export const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  );
  if (!course) {
    res.status(404);
    throw new Error('Course not found');
  }
  res.json({ success: true, data: course });
});

export const deleteCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) {
    res.status(404);
    throw new Error('Course not found');
  }

  const chapters = await Chapter.find({ courseId: course._id }).select('_id');
  const chapterIds = chapters.map((chapter) => chapter._id);
  await Quiz.deleteMany({ chapterId: { $in: chapterIds } });
  await QuizAttempt.deleteMany({ chapterId: { $in: chapterIds } });
  await Chapter.deleteMany({ courseId: course._id });
  await Certification.deleteMany({ courseId: course._id.toString() });
  await course.deleteOne();
  res.json({ success: true, message: 'Course and associated academy records removed' });
});

// ─── CHAPTERS ───

/**
 * @desc    Get all chapters (with lock/pass state for current agent)
 * @route   GET /api/academy/chapters
 * @access  Private
 */
export const getChapters = asyncHandler(async (req, res) => {
  const course = await getCourseForRequest(req.query.courseId, req.user);
  if (!course) return res.json({ success: true, data: [] });
  const chapters = await Chapter.find({ courseId: course._id }).sort({ order: 1 }).lean();

  if (req.user && req.user.role === 'sales_agent') {
    // Fetch passed attempts for this agent
    const passedAttempts = await QuizAttempt.find({
      agentId: req.user._id,
      passed: true,
    }).select('chapterId score');

    const passedChapterIds = new Set(passedAttempts.map((a) => a.chapterId.toString()));
    const scoreMap = new Map();
    passedAttempts.forEach((a) => {
      scoreMap.set(a.chapterId.toString(), a.score);
    });

    const enrichedChapters = chapters.map((ch, idx) => {
      const isPassed = passedChapterIds.has(ch._id.toString());
      // First chapter is unlocked by default; subsequent ones unlocked if previous is passed
      let isUnlocked = false;
      if (idx === 0) {
        isUnlocked = true;
      } else {
        const prevChapterId = chapters[idx - 1]._id.toString();
        isUnlocked = passedChapterIds.has(prevChapterId);
      }

      return {
        ...ch,
        isPassed,
        isUnlocked,
        bestScore: scoreMap.get(ch._id.toString()) || null,
      };
    });

    return res.json({ success: true, data: enrichedChapters });
  }

  res.json({ success: true, data: chapters });
});

/**
 * @desc    Create a chapter
 * @route   POST /api/academy/chapters
 * @access  Private/Admin
 */
export const createChapter = asyncHandler(async (req, res) => {
  const { courseId, order, title, content, attachments, coverImage } = req.body;
  const course = await Course.findById(courseId);
  if (!course) {
    res.status(400);
    throw new Error('A valid course is required');
  }

  const existing = await Chapter.findOne({ courseId, order });
  if (existing) {
    res.status(400);
    throw new Error(`Chapter with order ${order} already exists`);
  }

  const chapter = await Chapter.create({ courseId, order, title, content, attachments, coverImage: coverImage || '' });
  res.status(201).json({ success: true, data: chapter });
});

/**
 * @desc    Update a chapter
 * @route   PUT /api/academy/chapters/:id
 * @access  Private/Admin
 */
export const updateChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) {
    res.status(404);
    throw new Error('Chapter not found');
  }

  const { order, title, content, attachments, coverImage } = req.body;
  if (order !== undefined) chapter.order = order;
  if (title !== undefined) chapter.title = title;
  if (content !== undefined) chapter.content = content;
  if (attachments !== undefined) chapter.attachments = attachments;
  if (coverImage !== undefined) chapter.coverImage = coverImage;

  await chapter.save();
  res.json({ success: true, data: chapter });
});

/**
 * @desc    Delete a chapter
 * @route   DELETE /api/academy/chapters/:id
 * @access  Private/Admin
 */
export const deleteChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) {
    res.status(404);
    throw new Error('Chapter not found');
  }

  await Quiz.deleteOne({ chapterId: chapter._id });
  await QuizAttempt.deleteMany({ chapterId: chapter._id });
  await chapter.deleteOne();
  res.json({ success: true, message: 'Chapter and associated quiz removed' });
});

// ─── QUIZZES & ATTEMPTS ───

/**
 * @desc    Get quiz for a chapter
 * @route   GET /api/academy/quizzes/chapter/:chapterId
 * @access  Private
 */
export const getQuizByChapter = asyncHandler(async (req, res) => {
  const { chapterId } = req.params;
  const chapter = await Chapter.findById(chapterId).populate('courseId');
  if (!chapter || !chapter.courseId || (req.user.role !== 'admin' && chapter.courseId.audience !== req.user.role)) {
    res.status(403);
    throw new Error('This course is not available for your role');
  }
  const quiz = await Quiz.findOne({ chapterId }).lean();

  if (!quiz) {
    return res.status(404).json({ success: false, message: 'Quiz not found for this chapter' });
  }

  // If user is sales_agent, remove correctIndex so answers aren't exposed in network tab
  if (req.user.role === 'sales_agent') {
    quiz.questions = quiz.questions.map((q) => ({
      _id: q._id,
      text: q.text,
      options: q.options,
    }));
  }

  res.json({ success: true, data: quiz });
});

/**
 * @desc    Create or update quiz for a chapter
 * @route   POST /api/academy/quizzes
 * @access  Private/Admin
 */
export const upsertQuiz = asyncHandler(async (req, res) => {
  const { chapterId, questions } = req.body;

  if (!chapterId || !Array.isArray(questions)) {
    res.status(400);
    throw new Error('Please provide chapterId and an array of questions');
  }

  let quiz = await Quiz.findOne({ chapterId });
  if (quiz) {
    quiz.questions = questions;
    await quiz.save();
  } else {
    quiz = await Quiz.create({ chapterId, questions });
    // Link quizId back to chapter
    await Chapter.findByIdAndUpdate(chapterId, { quizId: quiz._id });
  }

  res.json({ success: true, data: quiz });
});

/**
 * @desc    Submit quiz attempt
 * @route   POST /api/academy/quizzes/submit
 * @access  Private (Sales Agent)
 */
export const submitQuiz = asyncHandler(async (req, res) => {
  const { chapterId, answers } = req.body; // answers: array of numbers (selected option index)

  const chapter = await Chapter.findById(chapterId);
  if (!chapter) {
    res.status(404);
    throw new Error('Chapter not found');
  }
  const course = await Course.findById(chapter.courseId);
  if (!course || course.audience !== req.user.role) {
    res.status(403);
    throw new Error('This course is not available for your role');
  }

  const quiz = await Quiz.findOne({ chapterId });
  if (!quiz) {
    res.status(404);
    throw new Error('Quiz not found');
  }

  if (!Array.isArray(answers) || answers.length !== quiz.questions.length) {
    res.status(400);
    throw new Error(`Please answer all ${quiz.questions.length} questions`);
  }

  // Calculate score
  let score = 0;
  quiz.questions.forEach((q, idx) => {
    if (answers[idx] === q.correctIndex) {
      score++;
    }
  });

  const passed = score >= 8;

  // Record attempt
  const attempt = await QuizAttempt.create({
    agentId: req.user._id,
    chapterId,
    score,
    passed,
  });

  const progress = await getCourseProgress(req.user._id, course._id);
  let certification = await Certification.findOne({
    agentId: req.user._id,
    courseId: course._id.toString(),
  });
  const wasCertified = Boolean(certification);

  if (progress.isComplete) {
    try {
      certification = await generateSalesAgentCertificate(req.user, course);
    } catch (certErr) {
      // Log error but allow attempt response to succeed
    }
  }

  res.json({
    success: true,
    data: {
      attemptId: attempt._id,
      score,
      passed,
      ...progress,
      certification,
      courseCompletedNow: Boolean(certification) && !wasCertified,
    },
  });
});

// ─── PROGRESS OVERVIEW ───

/**
 * @desc    Get current agent progress
 * @route   GET /api/academy/progress
 * @access  Private
 */
export const getMyProgress = asyncHandler(async (req, res) => {
  const agentId = req.user._id;
  const course = await getCourseForRequest(req.query.courseId, req.user);
  if (!course) return res.json({ success: true, data: null });
  const progress = await getCourseProgress(agentId, course._id);
  const certification = await Certification.findOne({
    agentId,
    courseId: course._id.toString(),
  });
  let resolvedCertification = certification;
  if (progress.isComplete && !resolvedCertification) {
    try {
      resolvedCertification = await generateSalesAgentCertificate(req.user, course);
    } catch (certErr) {
      // Keep progress available if certificate storage is temporarily unavailable.
    }
  }

  res.json({ success: true, data: { course, ...progress, certification: resolvedCertification } });
});

/**
 * @desc    Get progress overview of all sales agents for admin
 * @route   GET /api/academy/admin/agent-progress
 * @access  Private/Admin
 */
export const getAdminAgentProgress = asyncHandler(async (req, res) => {
  const courses = await Course.find({ audience: 'sales_agent', isActive: true }).sort({ createdAt: 1 });
  const salesAgents = await User.find({ role: 'sales_agent', isActive: true })
    .select('name email avatar createdAt')
    .lean();

  const progressData = [];
  for (const agent of salesAgents) {
    for (const course of courses) {
      const progress = await getCourseProgress(agent._id, course._id);
      const certification = await Certification.findOne({
        agentId: agent._id,
        courseId: course._id.toString(),
      });
      progressData.push({ agent, course, ...progress, isCertified: !!certification, certification });
    }
  }

  res.json({ success: true, data: progressData });
});

// ─── TRAINING CONTENT CMS ───

/**
 * @desc    Get training content materials
 * @route   GET /api/academy/training-content
 * @access  Private
 */
export const getTrainingContent = asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  const filter = {};

  if (category && category !== 'All') {
    filter.category = category;
  }

  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { body: { $regex: search, $options: 'i' } },
    ];
  }

  const items = await TrainingContent.find(filter).sort({ createdAt: -1 });
  res.json({ success: true, data: items });
});

/**
 * @desc    Create training content item
 * @route   POST /api/academy/training-content
 * @access  Private/Admin
 */
export const createTrainingContent = asyncHandler(async (req, res) => {
  const { title, documentTitle, body, fileUrl, category } = req.body;

  const item = await TrainingContent.create({
    title,
    documentTitle,
    body,
    fileUrl,
    category,
  });

  res.status(201).json({ success: true, data: item });
});

/**
 * @desc    Update training content item
 * @route   PUT /api/academy/training-content/:id
 * @access  Private/Admin
 */
export const updateTrainingContent = asyncHandler(async (req, res) => {
  const item = await TrainingContent.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Training content item not found');
  }

  const { title, documentTitle, body, fileUrl, category } = req.body;
  if (title !== undefined) item.title = title;
  if (documentTitle !== undefined) item.documentTitle = documentTitle;
  if (body !== undefined) item.body = body;
  if (fileUrl !== undefined) item.fileUrl = fileUrl;
  if (category !== undefined) item.category = category;

  await item.save();
  res.json({ success: true, data: item });
});

/**
 * @desc    Upload or replace a training content document
 * @route   POST /api/academy/training-content/:id/document
 * @access  Private/Admin
 */
export const uploadTrainingDocument = asyncHandler(async (req, res) => {
  const item = await TrainingContent.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Training content item not found');
  }

  if (!req.file) {
    res.status(400);
    throw new Error('Please select a document to upload');
  }

  item.fileUrl = req.file.path || req.file.secure_url || '';
  item.originalFileName = req.file.originalname || '';
  if (req.body.documentTitle !== undefined) {
    item.documentTitle = req.body.documentTitle.trim();
  }
  item.cloudinaryPublicId = req.file.filename || req.file.public_id || '';
  item.resourceType = req.file.resource_type || 'raw';
  await item.save();

  res.json({ success: true, data: item });
});

/**
 * @desc    Download a training content document
 * @route   GET /api/academy/training-content/:id/document/download
 * @access  Private
 */
export const downloadTrainingDocument = asyncHandler(async (req, res) => {
  const item = await TrainingContent.findById(req.params.id).select(
    'fileUrl originalFileName title'
  );
  if (!item || !item.fileUrl) {
    res.status(404);
    throw new Error('Training document not found');
  }

  return streamDocDownload(res, item.fileUrl, item.originalFileName || item.title);
});

/**
 * @desc    Delete training content item
 * @route   DELETE /api/academy/training-content/:id
 * @access  Private/Admin
 */
export const deleteTrainingContent = asyncHandler(async (req, res) => {
  const item = await TrainingContent.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Training content item not found');
  }

  await item.deleteOne();
  res.json({ success: true, message: 'Training content item removed' });
});

// ─── TRUCK TYPES ───

/**
 * @desc    Get all truck types
 * @route   GET /api/academy/truck-types
 * @access  Private
 */
export const getTruckTypes = asyncHandler(async (req, res) => {
  const truckTypes = await TruckType.find().sort({ category: 1, name: 1 });
  res.json({ success: true, data: truckTypes });
});

/**
 * @desc    Create truck type
 * @route   POST /api/academy/truck-types
 * @access  Private/Admin
 */
export const createTruckType = asyncHandler(async (req, res) => {
  const {
    name,
    category,
    equipmentType,
    imageUrl,
    images,
    description,
    trailerLengths,
    maxWeightCapacity,
    doorType,
    liftGate,
    trailerLength,
    stepDeckSubType,
    trailerConfig,
    trailerSize,
    cargoType,
    neckType,
    specializedEquipment,
    commonModels,
    commissionRate,
  } = req.body;

  const truckType = await TruckType.create({
    name,
    category,
    equipmentType,
    imageUrl,
    images: Array.isArray(images) ? images : (imageUrl ? [imageUrl] : []),
    description,
    trailerLengths,
    maxWeightCapacity,
    doorType,
    liftGate,
    trailerLength,
    stepDeckSubType,
    trailerConfig,
    trailerSize,
    cargoType,
    neckType,
    specializedEquipment,
    commonModels,
    commissionRate,
  });

  res.status(201).json({ success: true, data: truckType });
});

/**
 * @desc    Update truck type
 * @route   PUT /api/academy/truck-types/:id
 * @access  Private/Admin
 */
export const updateTruckType = asyncHandler(async (req, res) => {
  const truckType = await TruckType.findById(req.params.id);
  if (!truckType) {
    res.status(404);
    throw new Error('Truck type not found');
  }

  const {
    name,
    category,
    equipmentType,
    imageUrl,
    images,
    description,
    trailerLengths,
    maxWeightCapacity,
    doorType,
    liftGate,
    trailerLength,
    stepDeckSubType,
    trailerConfig,
    trailerSize,
    cargoType,
    neckType,
    specializedEquipment,
    commonModels,
    commissionRate,
  } = req.body;

  if (name !== undefined) truckType.name = name;
  if (category !== undefined) truckType.category = category;
  if (equipmentType !== undefined) truckType.equipmentType = equipmentType;
  if (imageUrl !== undefined) truckType.imageUrl = imageUrl;
  if (images !== undefined) truckType.images = Array.isArray(images) ? images : [];
  if (description !== undefined) truckType.description = description;
  if (trailerLengths !== undefined) truckType.trailerLengths = trailerLengths;
  if (maxWeightCapacity !== undefined) truckType.maxWeightCapacity = maxWeightCapacity;
  if (doorType !== undefined) truckType.doorType = doorType;
  if (liftGate !== undefined) truckType.liftGate = liftGate;
  if (trailerLength !== undefined) truckType.trailerLength = trailerLength;
  if (stepDeckSubType !== undefined) truckType.stepDeckSubType = stepDeckSubType;
  if (trailerConfig !== undefined) truckType.trailerConfig = trailerConfig;
  if (trailerSize !== undefined) truckType.trailerSize = trailerSize;
  if (cargoType !== undefined) truckType.cargoType = cargoType;
  if (neckType !== undefined) truckType.neckType = neckType;
  if (specializedEquipment !== undefined) truckType.specializedEquipment = specializedEquipment;
  if (commonModels !== undefined) truckType.commonModels = commonModels;
  if (commissionRate !== undefined) truckType.commissionRate = commissionRate;

  await truckType.save();
  res.json({ success: true, data: truckType });
});

/**
 * @desc    Delete truck type
 * @route   DELETE /api/academy/truck-types/:id
 * @access  Private/Admin
 */
export const deleteTruckType = asyncHandler(async (req, res) => {
  const truckType = await TruckType.findById(req.params.id);
  if (!truckType) {
    res.status(404);
    throw new Error('Truck type not found');
  }

  await truckType.deleteOne();
  res.json({ success: true, message: 'Truck type removed' });
});

// ─── QUESTIONS & FAQ ───

/**
 * @desc    Agent submits a new question to Admin
 * @route   POST /api/academy/questions
 * @access  Private (Sales Agent)
 */
export const askQuestion = asyncHandler(async (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    res.status(400);
    throw new Error('Question text is required');
  }

  const question = await Question.create({
    agentId: req.user._id,
    text: text.trim(),
  });

  // Notify admins
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
  for (const admin of admins) {
    await createNotification({
      recipientId: admin._id,
      type: 'academy_question',
      title: 'New Academy Question Submitted',
      message: `${req.user.name || 'Sales Agent'} submitted a new question: "${text.substring(0, 50)}..."`,
      relatedModel: 'Question',
      relatedId: question._id,
    });
  }

  res.status(201).json({ success: true, data: question });
});

/**
 * @desc    Get questions asked by current agent
 * @route   GET /api/academy/questions/my
 * @access  Private (Sales Agent)
 */
export const getMyQuestions = asyncHandler(async (req, res) => {
  const questions = await Question.find({ agentId: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: questions });
});

/**
 * @desc    Get FAQ items (where addedToFAQ === true)
 * @route   GET /api/academy/questions/faq
 * @access  Private
 */
export const getFAQ = asyncHandler(async (req, res) => {
  const faqItems = await Question.find({ addedToFAQ: true })
    .populate('agentId', 'name avatar')
    .sort({ updatedAt: -1 });

  res.json({ success: true, data: faqItems });
});

/**
 * @desc    Get all questions for Admin Q&A dashboard
 * @route   GET /api/academy/questions/admin
 * @access  Private/Admin
 */
export const getAdminQuestions = asyncHandler(async (req, res) => {
  const questions = await Question.find()
    .populate('agentId', 'name email avatar')
    .sort({ createdAt: -1 });

  res.json({ success: true, data: questions });
});

/**
 * @desc    Admin reply to question & toggle FAQ
 * @route   PUT /api/academy/questions/admin/:id/reply
 * @access  Private/Admin
 */
export const replyQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.id);
  if (!question) {
    res.status(404);
    throw new Error('Question not found');
  }

  const { adminReply, addedToFAQ } = req.body;

  if (adminReply !== undefined) {
    question.adminReply = adminReply;
    question.status = 'answered';
    question.answeredAt = new Date();
  }

  if (addedToFAQ !== undefined) {
    question.addedToFAQ = Boolean(addedToFAQ);
  }

  await question.save();

  // Notify agent if replied
  if (adminReply) {
    await createNotification({
      recipientId: question.agentId,
      type: 'academy_question',
      title: 'Academy Question Answered',
      message: `Admin replied to your question: "${question.text.substring(0, 50)}..."`,
      relatedModel: 'Question',
      relatedId: question._id,
    });
  }

  res.json({ success: true, data: question });
});

// ─── SEARCH ───

/**
 * @desc    Global text search across Chapters and Training Content
 * @route   GET /api/academy/search
 * @access  Private
 */
export const searchAcademy = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || !q.trim()) {
    return res.json({ success: true, data: { chapters: [], trainingContent: [] } });
  }

  const queryRegex = new RegExp(q.trim(), 'i');

  const [chapters, trainingContent] = await Promise.all([
    Chapter.find({
      $or: [{ title: queryRegex }, { content: queryRegex }],
    })
      .select('order title content')
      .sort({ order: 1 })
      .lean(),

    TrainingContent.find({
      $or: [{ title: queryRegex }, { body: queryRegex }],
    })
      .select('title body type category fileUrl')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  res.json({
    success: true,
    data: {
      chapters: chapters.map((c) => ({
        _id: c._id,
        order: c.order,
        title: c.title,
        snippet: c.content ? c.content.replace(/<[^>]*>?/gm, '').substring(0, 140) + '...' : '',
      })),
      trainingContent: trainingContent.map((t) => ({
        _id: t._id,
        title: t.title,
        category: t.category,
        type: t.type,
        snippet: t.body ? t.body.replace(/<[^>]*>?/gm, '').substring(0, 140) + '...' : '',
      })),
    },
  });
});

/**
 * @desc    Upload image for rich text editor / chapters
 * @route   POST /api/academy/upload-image
 * @access  Private/Admin
 */
export const uploadAcademyImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('Please upload an image file');
  }

  const url = req.file.path || req.file.secure_url || req.file.url;
  res.json({ success: true, url });
});
