# Avencix Backend API

Production-ready Express.js + MongoDB backend for the Avencix digital agency platform.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- MongoDB Atlas account (or local MongoDB)
- Cloudinary account (for file uploads)

### Installation

1. **Install dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   ```
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/avencix
   JWT_SECRET=your_super_secret_key_change_this
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   CLIENT_URL=http://localhost:5173
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

   Server runs on `http://localhost:5000`

### Production Build
```bash
npm start
```

## 📁 Project Structure

```
backend/
├── config/           # Database and service configuration
│   ├── db.js         # MongoDB connection (Vercel-optimized)
│   └── cloudinary.js # Cloudinary SDK config
├── controllers/      # Business logic (10 files)
├── middleware/       # Auth, uploads, error handling
├── models/          # Mongoose schemas (11 models)
├── routes/          # API endpoints (10 route files)
├── socket/          # Real-time Socket.io handlers
├── utils/           # Helper functions
├── server.js        # Express app entry point
├── vercel.json      # Vercel deployment config
├── package.json
├── .env             # Environment variables
└── .gitignore
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/admin-setup` - Create first admin (one-time)
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/change-password` - Change password

### Clients
- `GET /api/clients` - List all clients (admin)
- `POST /api/clients` - Create client (admin)
- `GET /api/clients/:id` - Get client details
- `PUT /api/clients/:id` - Update client
- `DELETE /api/clients/:id` - Delete client (admin)
- `POST /api/clients/from-website` - Web contact form (public)

### Pipeline
- `GET /api/pipeline` - Get all leads grouped by stage
- `POST /api/pipeline` - Create lead
- `PUT /api/pipeline/:id` - Update lead
- `PATCH /api/pipeline/:id/stage` - Move lead (drag-drop)
- `PATCH /api/pipeline/reorder` - Bulk reorder
- `DELETE /api/pipeline/:id` - Delete lead

### Proposals
- `GET /api/proposals` - List proposals
- `POST /api/proposals` - Create proposal (admin)
- `GET /api/proposals/:id` - Get proposal
- `PUT /api/proposals/:id` - Update proposal (admin)
- `PATCH /api/proposals/:id/send` - Send proposal (admin)
- `PATCH /api/proposals/:id/respond` - Client responds
- `DELETE /api/proposals/:id` - Delete (admin, draft only)

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project (admin)
- `GET /api/projects/:id` - Get project details
- `PUT /api/projects/:id` - Update project (admin)
- `PATCH /api/projects/:id/progress` - Update progress (admin)
- `POST /api/projects/:id/updates` - Add update (admin)
- `POST /api/projects/:id/invoices` - Add invoice (admin)
- `PATCH /api/projects/:id/invoices/:invoiceId` - Update invoice
- `POST /api/projects/:id/deliverables` - Add deliverable (admin)
- `PATCH /api/projects/:id/deliverables/:deliverableId` - Update deliverable

### Appointments
- `GET /api/appointments` - List appointments
- `POST /api/appointments` - Create appointment
- `GET /api/appointments/:id` - Get appointment
- `PUT /api/appointments/:id` - Update appointment
- `PATCH /api/appointments/:id/status` - Change status
- `DELETE /api/appointments/:id` - Delete (admin)

### Messaging
- `GET /api/messages/conversations` - Get all conversations
- `POST /api/messages/conversations` - Create/retrieve conversation
- `GET /api/messages/conversations/:id` - Get messages
- `POST /api/messages/send` - Send message (with file support)

### Notifications
- `GET /api/notifications` - List notifications
- `PATCH /api/notifications/:id/read` - Mark as read
- `PATCH /api/notifications/read-all` - Mark all as read
- `DELETE /api/notifications/:id` - Delete notification

### CMS
- `GET /api/cms/:section` - Get content by section (public)
- `POST /api/cms/:section` - Create content (admin)
- `PUT /api/cms/:section/:id` - Update content (admin)
- `DELETE /api/cms/:section/:id` - Delete content (admin)

### Blog
- `GET /api/blogs` - Get published posts
- `GET /api/blogs/:slug` - Get post by slug
- `POST /api/blogs` - Create post (admin)
- `PUT /api/blogs/:id` - Update post (admin)
- `DELETE /api/blogs/:id` - Delete post (admin)

## 🔐 Authentication & Authorization

### JWT Tokens
- Tokens stored in **httpOnly cookies** (secure)
- Expire after 7 days
- `GET /api/auth/me` returns current user

### Role-Based Access Control
- **Admin**: Full access to all endpoints
- **Client**: Limited access to own data
  - Can view only their own projects, proposals, appointments
  - Can respond to proposals
  - Can create appointments
  - Can message admin

### Protected Routes
```js
// Admin only
GET /api/clients
POST /api/pipeline
PATCH /api/proposals/:id/send

// Private (any authenticated user)
GET /api/auth/me
GET /api/messages/conversations
```

## 📤 File Uploads

### Cloudinary Integration
- Automatic folder organization by content type
- Supported: Images (5MB), Documents (20MB)
- Returns secure HTTPS URLs

**Folders:**
- `avencix/avatars` - Client avatars
- `avencix/cms` - CMS content images
- `avencix/projects` - Project files
- `avencix/messages` - Message attachments
- `avencix/invoices` - Invoice PDFs
- `avencix/deliverables` - Deliverable files

## 🔄 Real-Time Features (Socket.io)

### Server Events (Emitted to Clients)
- `new_message` - New message in conversation
- `new_notification` - New notification for user
- `typing_indicator` - User is/was typing
- `user_online` - User came online
- `user_offline` - User went offline

### Client Events (Listened to by Server)
- `join_conversation` - Join conversation room
- `leave_conversation` - Leave conversation
- `typing` - User started typing
- `stop_typing` - User stopped typing
- `mark_read` - Message read status

**Note:** Socket.io is disabled on Vercel (serverless) by default. For real-time features in production:
1. Use Railway, Render, or AWS EC2
2. Or implement REST API polling in frontend

## 🗄️ Database Models

### Core Models
1. **User** - Admin and client accounts
2. **Client** - Potential and existing clients
3. **PipelineLead** - Sales pipeline leads
4. **Proposal** - Project proposals
5. **Project** - Active client projects
6. **Appointment** - Scheduled appointments
7. **Conversation** - Messaging conversations
8. **Message** - Messages in conversations
9. **Notification** - In-app notifications
10. **BlogPost** - Blog articles
11. **CMSContent** - Website content sections

All models include:
- Timestamps (createdAt, updatedAt)
- Proper indexing for query performance
- Validation rules
- Relationships via references

## 📊 Data Validation

All models enforce:
- Required field validation
- Email format validation
- Enum validation (status, roles, types)
- Reference integrity
- Unique constraints

Example error responses:
```json
{
  "success": false,
  "message": "Client not found"
}

{
  "success": false,
  "message": "Not authorized. Admin access required."
}
```

## 🚀 Deployment

### Vercel (Serverless)
1. Push code to GitHub
2. Connect repo to Vercel
3. Add environment variables in Vercel Dashboard
4. Deploy automatically on push

**Note:** Socket.io will be disabled on Vercel. Use REST API instead.

### Railway / Render / AWS EC2
```bash
npm install
npm start
```
Socket.io will work normally.

### Environment Variables for Production
- Set `NODE_ENV=production`
- Use strong `JWT_SECRET` (min 32 chars)
- Use production MongoDB URI
- Use production Cloudinary credentials
- Set `CLIENT_URL` to your production frontend URL
- Set `SOCKET_ENABLED=true` if not on serverless

## 🔍 Testing Endpoints

### Use Postman or cURL

**Create Admin (First Time Only)**
```bash
POST http://localhost:5000/api/auth/admin-setup
Content-Type: application/json

{
  "name": "Admin User",
  "email": "admin@avencix.com",
  "password": "SecurePassword123"
}
```

**Login**
```bash
POST http://localhost:5000/api/auth/login
Content-Type: application/json

{
  "email": "admin@avencix.com",
  "password": "SecurePassword123"
}
```

**Get Clients (Requires Auth Cookie)**
```bash
GET http://localhost:5000/api/clients
```

## 📝 Security Checklist

- ✅ Passwords hashed with bcryptjs (10 rounds)
- ✅ JWT in httpOnly cookies (not localStorage)
- ✅ CORS restricted to CLIENT_URL
- ✅ All admin routes protected
- ✅ Client data isolation enforced
- ✅ Mongoose validation on all models
- ✅ Async error handling with express-async-handler
- ✅ No sensitive data in API responses
- ⚠️ TODO: Rate limiting (use express-rate-limit for production)

## 🐛 Common Issues

**MongoDB Connection Error**
- Check `MONGO_URI` format
- Ensure IP is whitelisted in MongoDB Atlas
- Check network connectivity

**Cloudinary Upload Fails**
- Verify credentials are correct
- Check file size limits
- Ensure CORS is configured

**Socket.io Not Working**
- Check if on Vercel (not supported)
- Verify JWT token is valid
- Check browser console for errors

**CORS Errors**
- Ensure `CLIENT_URL` matches frontend origin
- Check credentials are true in CORS config

## 📚 Additional Resources

- [Express.js Docs](https://expressjs.com/)
- [Mongoose Docs](https://mongoosejs.com/)
- [Socket.io Docs](https://socket.io/docs/)
- [Cloudinary Docs](https://cloudinary.com/documentation)
- [JWT Docs](https://jwt.io/)

## 📄 License

MIT
