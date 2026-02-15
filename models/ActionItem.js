const mongoose = require('mongoose');

const actionItemSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Action item title is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  meeting: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'completed', 'cancelled', 'blocked'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  dueDate: {
    type: Date,
    required: true
  },
  completedAt: Date,
  tags: [String],
  dependencies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActionItem'
  }],
  blockedBy: [{
    reason: String,
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ActionItem'
    }
  }],
  // Progress tracking
  progress: {
    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    updates: [{
      note: String,
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      timestamp: {
        type: Date,
        default: Date.now
      }
    }]
  },
  // Collaboration
  comments: [{
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    content: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  attachments: [{
    filename: String,
    url: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Reminders
  reminders: [{
    date: Date,
    sent: {
      type: Boolean,
      default: false
    }
  }],
  // Auto-extracted from meeting
  autoExtracted: {
    type: Boolean,
    default: false
  },
  sourceText: String, // Original text from meeting notes/transcript
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
actionItemSchema.index({ assignedTo: 1, status: 1 });
actionItemSchema.index({ meeting: 1 });
actionItemSchema.index({ dueDate: 1 });
actionItemSchema.index({ status: 1, priority: 1 });

// Update timestamp on save
actionItemSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Update completed date when status changes to completed
  if (this.isModified('status') && this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
    this.progress.percentage = 100;
  }
  
  next();
});

// Check if action item is overdue
actionItemSchema.methods.isOverdue = function() {
  return this.status !== 'completed' && this.dueDate < new Date();
};

// Get days until due
actionItemSchema.methods.daysUntilDue = function() {
  const diffTime = this.dueDate - new Date();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

module.exports = mongoose.model('ActionItem', actionItemSchema);
