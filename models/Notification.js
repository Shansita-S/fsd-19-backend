const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: [
      'meeting-reminder',
      'meeting-invitation',
      'meeting-updated',
      'meeting-cancelled',
      'meeting-started',
      'action-item-assigned',
      'action-item-due',
      'action-item-overdue',
      'action-item-completed',
      'participant-declined',
      'participant-accepted',
      'agenda-updated',
      'notes-shared',
      'feedback-requested',
      'smart-suggestion',
      'productivity-alert',
      'focus-time-blocked'
    ],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  // Related entities
  meeting: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting'
  },
  actionItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActionItem'
  },
  // Notification state
  read: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  sent: {
    type: Boolean,
    default: false
  },
  sentAt: Date,
  // Delivery channels
  channels: {
    push: {
      sent: { type: Boolean, default: false },
      sentAt: Date
    },
    email: {
      sent: { type: Boolean, default: false },
      sentAt: Date
    },
    sms: {
      sent: { type: Boolean, default: false },
      sentAt: Date
    },
    slack: {
      sent: { type: Boolean, default: false },
      sentAt: Date
    }
  },
  // Smart notification features
  contextAware: {
    skipIfInMeeting: {
      type: Boolean,
      default: true
    },
    skipIfDoNotDisturb: {
      type: Boolean,
      default: true
    },
    skipIfSameLocation: {
      type: Boolean,
      default: true
    }
  },
  // Action buttons for quick responses
  actions: [{
    label: String,
    action: String,
    performed: {
      type: Boolean,
      default: false
    }
  }],
  // Metadata
  metadata: mongoose.Schema.Types.Mixed,
  expiresAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 2592000 // Auto-delete after 30 days
  }
});

// Indexes
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ type: 1, sent: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Mark as read
notificationSchema.methods.markAsRead = function() {
  this.read = true;
  this.readAt = new Date();
  return this.save();
};

// Check if should be sent based on context
notificationSchema.methods.shouldSend = async function() {
  if (this.sent) return false;
  
  const User = mongoose.model('User');
  const user = await User.findById(this.recipient);
  
  if (!user) return false;
  
  // Check context-aware settings
  if (this.contextAware.skipIfDoNotDisturb && user.currentStatus.status === 'do-not-disturb') {
    return false;
  }
  
  if (this.contextAware.skipIfInMeeting && user.currentStatus.status === 'in-meeting') {
    // Unless it's urgent
    if (this.priority !== 'urgent') return false;
  }
  
  return true;
};

module.exports = mongoose.model('Notification', notificationSchema);
