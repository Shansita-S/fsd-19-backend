# Schedulify – Smart Meeting Organizer  - Backend

## 📋 Project Overview
A robust backend API for a Meeting Scheduling Management System that allows organizers to schedule meetings and participants to view them. The system prevents participant conflicts and ensures data persistence using MongoDB.

## 🚀 Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Mongoose ODM)
- **Authentication**: JWT (JSON Web Tokens)
- **Validation**: Express-validator
- **Security**: bcryptjs for password hashing
- **CORS**: Enabled for cross-origin requests

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
  participants: [ObjectId] (ref: User),
  createdAt: Date
}
```

**Indexes:**
- `{ organizer: 1, startTime: 1 }` - For efficient organizer queries
- `{ participants: 1, startTime: 1 }` - For efficient participant queries

## ⚠️ Critical Business Rule: Conflict Detection

The system implements robust conflict detection to prevent participant scheduling conflicts:

### Conflict Detection Logic
- When creating/updating a meeting, the system checks all assigned participants
- Detects overlapping meetings using three scenarios:
  1. New meeting starts during an existing meeting
  2. New meeting ends during an existing meeting
  3. New meeting completely contains an existing meeting
  
### Conflict Response
- Returns **409 Conflict** status code
- Provides detailed conflict information:
  - Participant name and email
  - Conflicting meeting details (title, time, organizer)
  - Allows organizer to adjust participants or timing

### Algorithm
```javascript
checkParticipantConflict(participantId, startTime, endTime) {
  Find meetings where:
    - Participant is assigned AND
    - (startTime <= newStart < endTime OR
       startTime < newEnd <= endTime OR
       newStart <= startTime AND endTime <= newEnd)
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

## 📦 Deployment

### Deployment Options
1. **Render.com** (Recommended)
2. **Heroku**
3. **Railway**
4. **AWS EC2**
5. **DigitalOcean**

### Deployment Steps (Render.com)
1. Push code to GitHub repository
2. Create a new Web Service on Render
3. Connect your GitHub repository
4. Set environment variables in Render dashboard
5. Deploy!

### Important Deployment Notes
- Set `NODE_ENV=production`
- Whitelist your frontend domain in CORS settings
- Ensure MongoDB Atlas allows connections from your deployment IP

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

## 📄 License
MIT License

## 🤝 Contributing
This is an assignment project. No contributions are expected.

## 📞 Support
For issues or questions, please contact the development team.

---
**Built with ❤️ for FSD Assignment**
