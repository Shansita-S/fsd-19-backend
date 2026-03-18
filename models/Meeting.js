const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Meeting title is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  startTime: {
    type: Date,
    required: [true, 'Start time is required']
  },
  endTime: {
    type: Date,
    required: [true, 'End time is required']
  },
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Organizer is required']
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'tentative'],
      default: 'pending'
    },
    responseTime: Date
  }],
  status: {
    type: String,
    enum: ['scheduled', 'in-progress', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  // Agenda items for the meeting
  agenda: [{
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: String,
    duration: Number, // in minutes
    order: Number
  }],
  // Meeting notes
  notes: [{
    content: {
      type: String,
      required: true
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
meetingSchema.index({ organizer: 1, startTime: 1 });
meetingSchema.index({ 'participants.user': 1, startTime: 1 });
meetingSchema.index({ status: 1, startTime: 1 });

// Update timestamp on save
meetingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to check if a participant has a conflict
meetingSchema.statics.checkParticipantConflict = async function(participantId, startTime, endTime, excludeMeetingId = null) {
  const query = {
    'participants.user': participantId,
    status: { $in: ['scheduled', 'in-progress'] },
    // Two time intervals overlap if: existingStart < newEnd AND existingEnd > newStart
    startTime: { $lt: endTime },
    endTime: { $gt: startTime }
  };
  
  // Exclude current meeting if updating
  if (excludeMeetingId) {
    query._id = { $ne: excludeMeetingId };
  }
  
  const conflictingMeetings = await this.find(query).populate('organizer', 'name email');
  return conflictingMeetings;
};

// Find available time slots for participants
meetingSchema.statics.findAvailableSlots = async function(participantIds, duration, searchStart, searchEnd) {
  const availableSlots = [];
  
  // Get all meetings for these participants in the search range
  const busySlots = await this.find({
    'participants.user': { $in: participantIds },
    status: { $in: ['scheduled', 'in-progress'] },
    startTime: { $lt: searchEnd },
    endTime: { $gt: searchStart }
  }).sort('startTime').select('startTime endTime');
  
  // Business hours: 9 AM to 6 PM
  const businessHourStart = 9;
  const businessHourEnd = 18;
  
  let currentCheckTime = new Date(searchStart);
  
  // Skip to next business day start if starting outside business hours
  if (currentCheckTime.getHours() < businessHourStart) {
    currentCheckTime.setHours(businessHourStart, 0, 0, 0);
  } else if (currentCheckTime.getHours() >= businessHourEnd) {
    currentCheckTime.setDate(currentCheckTime.getDate() + 1);
    currentCheckTime.setHours(businessHourStart, 0, 0, 0);
  }
  
  // Check each 30-minute slot - search through entire date range
  while (currentCheckTime < searchEnd) {
    const slotEnd = new Date(currentCheckTime.getTime() + duration * 60000);
    
    // Check if within business hours - both start and end must be within hours
    const hour = currentCheckTime.getHours();
    const endHour = slotEnd.getHours();
    const endMinutes = slotEnd.getMinutes();
    
    // Meeting must start and end within business hours
    const isBusinessHour = hour >= businessHourStart && 
                          hour < businessHourEnd && 
                          (endHour < businessHourEnd || (endHour === businessHourEnd && endMinutes === 0));
    
    // Check if slot is free for all participants
    const isSlotFree = !busySlots.some(meeting => {
      return (currentCheckTime < meeting.endTime && slotEnd > meeting.startTime);
    });
    
    if (isSlotFree && isBusinessHour) {
      availableSlots.push({
        startTime: new Date(currentCheckTime),
        endTime: new Date(slotEnd)
      });
    }
    
    // Move to next 30-minute slot
    currentCheckTime = new Date(currentCheckTime.getTime() + 30 * 60000);
    
    // Skip to next day if outside business hours
    if (currentCheckTime.getHours() >= businessHourEnd) {
      currentCheckTime.setDate(currentCheckTime.getDate() + 1);
      currentCheckTime.setHours(businessHourStart, 0, 0, 0);
    }
  }
  
  return availableSlots;
};

// Find best common slot for all participants
meetingSchema.statics.findBestCommonSlot = async function(participantIds, duration, daysToSearch = 7) {
  const now = new Date();
  const searchStart = new Date(now.getTime() + 60 * 60000); // Start from 1 hour from now
  const searchEnd = new Date(now.getTime() + daysToSearch * 24 * 60 * 60000);
  
  const availableSlots = await this.findAvailableSlots(participantIds, duration, searchStart, searchEnd);
  
  if (availableSlots.length === 0) {
    return null;
  }
  
  // Score slots based on how soon they are and time of day
  const scoredSlots = availableSlots.map(slot => {
    let score = 100;
    
    // Prefer slots sooner (within reason)
    const hoursFromNow = (slot.startTime - now) / (1000 * 60 * 60);
    if (hoursFromNow < 24) score += 20; // Today
    else if (hoursFromNow < 48) score += 10; // Tomorrow
    
    // Prefer mid-morning and early afternoon slots
    const hour = slot.startTime.getHours();
    if (hour >= 10 && hour <= 11) score += 15; // Late morning
    else if (hour >= 14 && hour <= 15) score += 10; // Early afternoon
    
    return { ...slot, score };
  });
  
  // Group slots by day to ensure distribution across multiple days
  const slotsByDay = {};
  scoredSlots.forEach(slot => {
    const dateKey = slot.startTime.toISOString().split('T')[0];
    if (!slotsByDay[dateKey]) {
      slotsByDay[dateKey] = [];
    }
    slotsByDay[dateKey].push(slot);
  });
  
  // Get top 2 slots from each day, then sort all by score
  const distributedSlots = [];
  Object.keys(slotsByDay).forEach(day => {
    const daySlots = slotsByDay[day].sort((a, b) => b.score - a.score).slice(0, 2);
    distributedSlots.push(...daySlots);
  });
  
  // Return top 10 slots overall (distributed across days)
  return distributedSlots.sort((a, b) => b.score - a.score).slice(0, 10);
};

module.exports = mongoose.model('Meeting', meetingSchema);
