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
    required: [true, 'End time is required'],
    validate: {
      validator: function(value) {
        return value > this.startTime;
      },
      message: 'End time must be after start time'
    }
  },
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Organizer is required']
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
meetingSchema.index({ organizer: 1, startTime: 1 });
meetingSchema.index({ participants: 1, startTime: 1 });

// Method to check if a participant has a conflict
meetingSchema.statics.checkParticipantConflict = async function(participantId, startTime, endTime, excludeMeetingId = null) {
  const query = {
    participants: participantId,
    $or: [
      // New meeting starts during existing meeting
      { startTime: { $lte: startTime }, endTime: { $gt: startTime } },
      // New meeting ends during existing meeting
      { startTime: { $lt: endTime }, endTime: { $gte: endTime } },
      // New meeting completely contains existing meeting
      { startTime: { $gte: startTime }, endTime: { $lte: endTime } }
    ]
  };
  
  // Exclude current meeting if updating
  if (excludeMeetingId) {
    query._id = { $ne: excludeMeetingId };
  }
  
  const conflictingMeetings = await this.find(query).populate('organizer', 'name email');
  return conflictingMeetings;
};

module.exports = mongoose.model('Meeting', meetingSchema);
