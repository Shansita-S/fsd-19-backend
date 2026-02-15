# Meeting Scheduling Management System - Backend

## 📋 Project Overview
A robust backend API for a Meeting Scheduling Management System with **AI-powered conflict resolution**. The system not only detects scheduling conflicts but also **automatically suggests optimal alternative time slots** - a unique feature that solves scheduling problems instead of just reporting them.

## 🚀 Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Mongoose ODM)
- **Authentication**: JWT (JSON Web Tokens)
- **Validation**: Express-validator
- **Security**: bcryptjs for password hashing
- **CORS**: Enabled for cross-origin requests

## 🌟 Unique Features
- 🔍 **Auto-Find Best Slot**: Intelligent algorithm finds optimal meeting times
- ✨ **Smart Conflict Resolution**: Suggests alternative slots when conflicts occur
- 🎯 **Scoring Algorithm**: Ranks time slots based on multiple factors
- ⚡ **30-minute slot analysis**: Scans business hours efficiently

## 👥 User Roles and Permissions

### ORGANIZER
- Register and login to the system
- Create meetings with date and time range
- Add participants to meetings
- View all meetings they created
- Update/Edit their meetings
- Delete their meetings

### PARTICIPANT
- Register and login to the system
- View meetings they are invited to
- Cannot create or modify meetings

## 🔐 Authentication & Authorization
- **JWT-based authentication** with 30-day token expiration
- All API routes (except register/login) are protected
- Role-based access control enforced on all endpoints
- Passwords hashed using bcryptjs with salt rounds

## 📡 API Endpoints

### Authentication Routes (`/api/auth`)
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/register` | Public | Register a new user |
| POST | `/login` | Public | Login user |
| GET | `/me` | Private | Get current user info |

### Meeting Routes (`/api/meetings`)
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/` | Organizer | Create a new meeting |
| GET | `/` | Private | Get all meetings (filtered by role) |
| GET | `/:id` | Private | Get single meeting |
| PUT | `/:id` | Organizer | Update meeting |
| DELETE | `/:id` | Organizer | Delete meeting |
| **POST** | **`/find-best-slot`** | **Organizer** | **🌟 Find optimal time slots** |

### User Routes (`/api/users`)
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/participants` | Organizer | Get all participants |

## 🗄️ Database Schema

### User Model
```javascript
{
  name: String (required),
  email: String (required, unique, lowercase),
  password: String (required, hashed, min 6 chars),
  role: String (enum: ['ORGANIZER', 'PARTICIPANT']),
  createdAt: Date
}
```

### Meeting Model
```javascript
{
  title: String (required),
  description: String,
  startTime: Date (required),
  endTime: Date (required, must be after startTime),
  organizer: ObjectId (ref: User),
  participants: [{
    user: ObjectId (ref: User),
    status: String (enum: ['pending', 'accepted', 'declined', 'tentative']),
    responseTime: Date
  }],
  status: String (enum: ['scheduled', 'in-progress', 'completed', 'cancelled']),
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:**
- `{ organizer: 1, startTime: 1 }` - For efficient organizer queries
- `{ 'participants.user': 1, startTime: 1 }` - For efficient participant queries
- `{ status: 1, startTime: 1 }` - For conflict detection optimization

## ⚠️ Critical Business Rule: Conflict Detection + Smart Resolution

The system implements robust conflict detection with **automatic alternative slot suggestions**:

### Conflict Detection Logic
- When creating/updating a meeting, the system checks all assigned participants
- Detects overlapping meetings using interval comparison:
  - Time intervals overlap if: `existingStart < newEnd AND existingEnd > newStart`
  
### Smart Resolution Feature 🌟
**What makes this special:** Most schedulers just say "Conflict detected ❌"  
**Our system:** Returns conflict details **+ suggests 5 best alternative slots** ✨

### Conflict Response
- Returns **409 Conflict** status code
- Provides detailed conflict information:
  - Participant name and email
  - Conflicting meeting details (title, time, organizer)
  - **NEW:** Array of suggested available time slots with scores
- Allows organizer to click and apply suggested slots

### Algorithm
```javascript
// Conflict Detection
checkParticipantConflict(participantId, startTime, endTime) {
  Find meetings where:
    - Participant is assigned AND
    - Status is 'scheduled' or 'in-progress' AND
    - startTime < newEnd AND endTime > newStart
}

// Smart Slot Finding
findBestCommonSlot(participantIds, duration, daysToSearch) {
  1. Get all busy slots for participants
  2. Check every 30-minute slot in business hours (9 AM - 6 PM)
  3. Score available slots:
     - Base: 100 points
     - Today: +20 points
     - Tomorrow: +10 points
     - Late morning (10-11 AM): +15 points
     - Early afternoon (2-3 PM): +10 points
  4. Return top 5 slots sorted by score
}
```

## 🛠️ Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- MongoDB Atlas account or local MongoDB
- npm or yarn

### Environment Variables
Create a `.env` file in the Backend directory:
```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_super_secret_jwt_key
NODE_ENV=development
```

### Installation Steps
```bash
# Navigate to backend directory
cd Backend

# Install dependencies
npm install

# Start development server
npm run dev

# Or start production server
npm start
```

### Install Dependencies
```bash
npm install express mongoose bcryptjs jsonwebtoken dotenv cors express-validator
npm install --save-dev nodemon
```

## 🧪 Testing the API

### Register User
```bash
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "ORGANIZER"
}
```

### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

### Create Meeting (requires JWT token)
```bash
POST /api/meetings
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "title": "Team Standup",
  "description": "Daily standup meeting",
  "startTime": "2026-02-15T10:00:00Z",
  "endTime": "2026-02-15T10:30:00Z",
  "participants": ["participantId1", "participantId2"]
}
```

### 🌟 Find Best Slot (Auto-Schedule)
```bash
POST /api/meetings/find-best-slot
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "participants": ["participantId1", "participantId2"],
  "duration": 60,  // Meeting duration in minutes
  "daysToSearch": 7  // Search next 7 days (optional, default: 7)
}

# Response:
{
  "success": true,
  "message": "Found 5 available slot(s)",
  "suggestedSlots": [
    {
      "startTime": "2026-02-16T10:00:00.000Z",
      "endTime": "2026-02-16T11:00:00.000Z",
      "score": 125
    },
    {
      "startTime": "2026-02-16T14:00:00.000Z",
      "endTime": "2026-02-16T15:00:00.000Z",
      "score": 110
    }
    // ... more slots
  ]
}
```
## 🔒 Security Features
- Passwords hashed with bcrypt (10 salt rounds)
- JWT tokens for stateless authentication
- Protected routes with authentication middleware
- Role-based authorization
- Input validation on all endpoints
- MongoDB injection prevention through Mongoose
- CORS configured for security

## 📊 API Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "errors": [ ... ] // Optional validation errors
}
```

### Conflict Response (409)
```json
{
  "success": false,
  "message": "Scheduling conflict detected",
  "conflicts": [
    {
      "participant": {
        "id": "...",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "conflictingMeetings": [
        {
          "id": "...",
          "title": "Existing Meeting",
          "startTime": "...",
          "endTime": "...",
          "organizer": { ... }
        }
      ]
    }
  ],
  "suggestedSlots": [
    {
      "startTime": "2026-02-16T10:00:00.000Z",
      "endTime": "2026-02-16T11:00:00.000Z",
      "score": 125
    },
    {
      "startTime": "2026-02-16T14:00:00.000Z",
      "endTime": "2026-02-16T15:00:00.000Z",
      "score": 110
    }
  ]
}
```

## 📝 Error Handling
- 400: Bad Request (validation errors)
- 401: Unauthorized (invalid/missing token)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 409: Conflict (scheduling conflicts)
- 500: Internal Server Error

## 🌐 Live Deployment Links
- **Backend API**: [To be deployed]
- **API Documentation**: Available via testing tools (Postman/Thunder Client)

## 👨‍💻 Development
```bash
# Run in development mode with auto-reload
npm run dev

# Run in production mode
npm start
```


