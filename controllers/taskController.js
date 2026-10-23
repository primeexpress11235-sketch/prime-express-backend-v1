import asyncHandler from 'express-async-handler';
import Task from '../models/Task.js';
import { success, error } from '../utils/sendResponse.js';
import { createNotification } from '../utils/notificationHelper.js';

/**
 * @route   GET /api/tasks
 * @desc    List tasks, filterable by ?assignedTo and ?status
 * @access  Private/Admin
 */
export const getTasks = asyncHandler(async (req, res) => {
  const { assignedTo, status } = req.query;
  const query = {};
  if (req.user.role !== 'admin') {
    query.assignedTo = req.user._id;
  } else if (assignedTo) {
    query.assignedTo = assignedTo;
  }
  if (status) query.status = status;

  const tasks = await Task.find(query)
    .populate('assignedTo', 'name email role')
    .populate('assignedBy', 'name')
    .sort('-createdAt');

  return success(res, 200, tasks, 'Tasks retrieved');
});

/**
 * @route   POST /api/tasks
 * @desc    Create and assign a task; notifies the assignee.
 * @access  Private/Admin
 */
export const createTask = asyncHandler(async (req, res) => {
  const { assignedTo, title, description, dueDate } = req.body;
  if (!assignedTo || !title) return error(res, 400, 'Assignee and title are required');

  const task = await Task.create({
    assignedTo,
    assignedBy: req.user._id,
    title,
    description,
    dueDate: dueDate || undefined,
  });

  await createNotification({
    recipientId: assignedTo,
    type: 'task_assigned',
    title: 'New task assigned',
    body: `You have been assigned a task: "${title}".`,
    relatedModel: 'Task',
    relatedId: task._id,
  });

  await task.populate('assignedTo', 'name email role');
  return success(res, 201, task, 'Task created');
});

/**
 * @route   PATCH /api/tasks/:id
 * @desc    Update a task (status, title, etc.)
 * @access  Private/Admin
 */
export const updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return error(res, 404, 'Task not found');

  const { title, description, dueDate, status, assignedTo } = req.body;
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (dueDate !== undefined) task.dueDate = dueDate || undefined;
  if (assignedTo !== undefined) task.assignedTo = assignedTo;
  if (status !== undefined) {
    if (!['pending', 'done'].includes(status)) return error(res, 400, 'Invalid status');
    task.status = status;
  }

  await task.save();
  await task.populate('assignedTo', 'name email role');
  return success(res, 200, task, 'Task updated');
});

/**
 * @route   DELETE /api/tasks/:id
 * @desc    Delete a task
 * @access  Private/Admin
 */
export const deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.id);
  if (!task) return error(res, 404, 'Task not found');
  return success(res, 200, null, 'Task deleted');
});

export default { getTasks, createTask, updateTask, deleteTask };
