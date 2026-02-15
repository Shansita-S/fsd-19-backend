const mongoose = require('mongoose');

// Analytics Schema for tracking meeting patterns and productivity
const meetingAnalyticsSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  period: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  // Meeting Statistics
  metrics: {
    totalMeetings: {
      type: Number,
      default: 0
    },
    meetingsOrganized: {
      type: Number,
      default: 0
    },
    meetingsAttended: {
      type: Number,
      default: 0
    },
    meetingsCancelled: {
      type: Number,
      default: 0
    },
    totalMeetingMinutes: {
      type: Number,
      default: 0
    },
    averageMeetingDuration: {
      type: Number,
      default: 0
    },
    // Time analysis
    meetingTimeByType: [{
      type: String,
      minutes: Number
    }],
    meetingTimeByHour: [{
      hour: Number,
      count: Number,
      minutes: Number
    }],
    meetingTimeByDay: [{
      day: Number, // 0-6
      count: Number,
      minutes: Number
    }],
    // Productivity metrics
    onTimeMeetings: {
      type: Number,
      default: 0
    },
    lateMeetings: {
      type: Number,
      default: 0
    },
    averageLateMinutes: {
      type: Number,
      default: 0
    },
    overrunMeetings: {
      type: Number,
      default: 0
    },
    averageOverrunMinutes: {
      type: Number,
      default: 0
    },
    // Participation
    averageAttendanceRate: {
      type: Number,
      default: 100
    },
    totalParticipants: {
      type: Number,
      default: 0
    },
    averageParticipantsPerMeeting: {
      type: Number,
      default: 0
    }
  },
  // Health Scores
  scores: {
    meetingHealthScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100
    },
    productivityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    workLifeBalanceScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100
    },
    engagementScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },
  // Insights and Recommendations
  insights: [{
    type: {
      type: String,
      enum: [
        'meeting-overload',
        'fragmented-schedule',
        'low-productivity-hours',
        'frequent-cancellations',
        'poor-attendance',
        'missing-agendas',
        'action-item-backlog',
        'positive-trend',
        'optimal-schedule'
      ]
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info'
    },
    title: String,
    description: String,
    recommendation: String,
    impact: String,
    generatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Action Items Statistics
  actionItems: {
    total: {
      type: Number,
      default: 0
    },
    completed: {
      type: Number,
      default: 0
    },
    overdue: {
      type: Number,
      default: 0
    },
    completionRate: {
      type: Number,
      default: 0
    },
    averageCompletionTime: {
      type: Number,
      default: 0
    }
  },
  // Cost Analysis (based on time spent)
  costAnalysis: {
    estimatedCost: {
      type: Number,
      default: 0
    },
    costByMeetingType: [{
      type: String,
      cost: Number
    }],
    highestCostMeetings: [{
      meeting: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Meeting'
      },
      cost: Number
    }]
  },
  // Trends (comparison with previous period)
  trends: {
    meetingCountChange: {
      type: Number,
      default: 0
    }, // percentage
    durationChange: {
      type: Number,
      default: 0
    },
    productivityChange: {
      type: Number,
      default: 0
    },
    healthScoreChange: {
      type: Number,
      default: 0
    }
  },
  // Focus Time Analysis
  focusTime: {
    totalMinutesAvailable: {
      type: Number,
      default: 0
    },
    minutesProtected: {
      type: Number,
      default: 0
    },
    minutesInterrupted: {
      type: Number,
      default: 0
    },
    longestFocusBlock: {
      type: Number,
      default: 0
    },
    protectionRate: {
      type: Number,
      default: 0
    }
  },
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
meetingAnalyticsSchema.index({ user: 1, period: 1, startDate: 1 });
meetingAnalyticsSchema.index({ 'scores.meetingHealthScore': 1 });
meetingAnalyticsSchema.index({ 'scores.productivityScore': 1 });

// Update timestamp
meetingAnalyticsSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to generate analytics for a user
meetingAnalyticsSchema.statics.generateAnalytics = async function(userId, period, startDate, endDate) {
  const Meeting = mongoose.model('Meeting');
  const ActionItem = mongoose.model('ActionItem');
  const User = mongoose.model('User');
  
  // Get all meetings for the user in the period
  const meetings = await Meeting.find({
    $or: [
      { organizer: userId },
      { 'participants.user': userId }
    ],
    startTime: { $gte: startDate, $lte: endDate },
    status: { $in: ['scheduled', 'completed', 'in-progress'] }
  });
  
  // Calculate metrics
  const metrics = calculateMetrics(meetings, userId);
  const scores = calculateScores(metrics, meetings);
  const insights = generateInsights(metrics, scores, meetings);
  const actionItemStats = await calculateActionItemStats(userId, startDate, endDate, ActionItem);
  const focusTimeStats = calculateFocusTime(meetings, startDate, endDate);
  
  // Create or update analytics
  const analytics = await this.findOneAndUpdate(
    { user: userId, period, startDate, endDate },
    {
      user: userId,
      period,
      startDate,
      endDate,
      metrics,
      scores,
      insights,
      actionItems: actionItemStats,
      focusTime: focusTimeStats
    },
    { upsert: true, new: true }
  );
  
  // Update user's analytics summary
  await User.findByIdAndUpdate(userId, {
    'analytics.totalMeetings': metrics.totalMeetings,
    'analytics.totalMeetingHours': Math.round(metrics.totalMeetingMinutes / 60),
    'analytics.averageMeetingDuration': metrics.averageMeetingDuration,
    'analytics.meetingHealthScore': scores.meetingHealthScore,
    'analytics.productivityScore': scores.productivityScore,
    'analytics.completedActionItems': actionItemStats.completed,
    'analytics.createdActionItems': actionItemStats.total
  });
  
  return analytics;
};

// Helper functions
function calculateMetrics(meetings, userId) {
  const metrics = {
    totalMeetings: meetings.length,
    meetingsOrganized: meetings.filter(m => m.organizer.toString() === userId.toString()).length,
    meetingsAttended: meetings.length,
    meetingsCancelled: meetings.filter(m => m.status === 'cancelled').length,
    totalMeetingMinutes: 0,
    averageMeetingDuration: 0,
    meetingTimeByType: [],
    meetingTimeByHour: Array(24).fill(0).map((_, i) => ({ hour: i, count: 0, minutes: 0 })),
    meetingTimeByDay: Array(7).fill(0).map((_, i) => ({ day: i, count: 0, minutes: 0 })),
    onTimeMeetings: 0,
    lateMeetings: 0,
    averageLateMinutes: 0,
    overrunMeetings: 0,
    averageOverrunMinutes: 0,
    averageAttendanceRate: 0,
    totalParticipants: 0,
    averageParticipantsPerMeeting: 0
  };
  
  let totalLateMinutes = 0;
  let totalOverrunMinutes = 0;
  let totalAttendanceRate = 0;
  
  meetings.forEach(meeting => {
    const duration = (meeting.endTime - meeting.startTime) / (1000 * 60);
    metrics.totalMeetingMinutes += duration;
    
    const hour = meeting.startTime.getHours();
    const day = meeting.startTime.getDay();
    
    metrics.meetingTimeByHour[hour].count++;
    metrics.meetingTimeByHour[hour].minutes += duration;
    metrics.meetingTimeByDay[day].count++;
    metrics.meetingTimeByDay[day].minutes += duration;
    
    if (meeting.analytics) {
      if (meeting.analytics.lateStartMinutes > 0) {
        metrics.lateMeetings++;
        totalLateMinutes += meeting.analytics.lateStartMinutes;
      } else {
        metrics.onTimeMeetings++;
      }
      
      if (meeting.analytics.overrunMinutes > 0) {
        metrics.overrunMeetings++;
        totalOverrunMinutes += meeting.analytics.overrunMinutes;
      }
      
      if (meeting.analytics.attendanceRate) {
        totalAttendanceRate += meeting.analytics.attendanceRate;
      }
    }
    
    metrics.totalParticipants += meeting.participants.length;
  });
  
  if (meetings.length > 0) {
    metrics.averageMeetingDuration = Math.round(metrics.totalMeetingMinutes / meetings.length);
    metrics.averageParticipantsPerMeeting = Math.round(metrics.totalParticipants / meetings.length);
    metrics.averageAttendanceRate = Math.round(totalAttendanceRate / meetings.length);
  }
  
  if (metrics.lateMeetings > 0) {
    metrics.averageLateMinutes = Math.round(totalLateMinutes / metrics.lateMeetings);
  }
  
  if (metrics.overrunMeetings > 0) {
    metrics.averageOverrunMinutes = Math.round(totalOverrunMinutes / metrics.overrunMeetings);
  }
  
  return metrics;
}

function calculateScores(metrics, meetings) {
  let healthScore = 100;
  let productivityScore = 100;
  let workLifeBalance = 100;
  let engagement = 0;
  
  // Health score deductions
  if (metrics.totalMeetingMinutes > 1200) { // More than 20 hours/week
    healthScore -= 30;
    workLifeBalance -= 40;
  }
  
  if (metrics.averageLateMinutes > 5) {
    healthScore -= 15;
    productivityScore -= 20;
  }
  
  if (metrics.averageOverrunMinutes > 10) {
    healthScore -= 10;
    productivityScore -= 15;
  }
  
  if (metrics.meetingsCancelled > metrics.totalMeetings * 0.1) {
    healthScore -= 20;
  }
  
  // Productivity bonuses
  const meetingsWithAgenda = meetings.filter(m => m.agenda && m.agenda.length > 0).length;
  if (meetingsWithAgenda / meetings.length > 0.8) {
    productivityScore += 10;
  }
  
  const meetingsWithActionItems = meetings.filter(m => m.actionItems && m.actionItems.length > 0).length;
  if (meetingsWithActionItems / meetings.length > 0.5) {
    productivityScore += 15;
  }
  
  // Engagement score
  const feedbackCount = meetings.reduce((sum, m) => sum + (m.feedback ? m.feedback.length : 0), 0);
  engagement = Math.min(100, (feedbackCount / meetings.length) * 100);
  
  return {
    meetingHealthScore: Math.max(0, Math.min(100, healthScore)),
    productivityScore: Math.max(0, Math.min(100, productivityScore)),
    workLifeBalanceScore: Math.max(0, Math.min(100, workLifeBalance)),
    engagementScore: Math.round(engagement)
  };
}

function generateInsights(metrics, scores, meetings) {
  const insights = [];
  
  // Meeting overload
  if (metrics.totalMeetingMinutes > 1200) {
    insights.push({
      type: 'meeting-overload',
      severity: 'critical',
      title: 'Meeting Overload Detected',
      description: `You spent ${Math.round(metrics.totalMeetingMinutes / 60)} hours in meetings this period.`,
      recommendation: 'Consider declining non-essential meetings or suggesting async alternatives.',
      impact: 'Reducing meeting time by 20% could free up 4+ hours for focused work.'
    });
  }
  
  // Frequent late starts
  if (metrics.averageLateMinutes > 5) {
    insights.push({
      type: 'low-productivity-hours',
      severity: 'warning',
      title: 'Meetings Often Start Late',
      description: `Average late start: ${metrics.averageLateMinutes} minutes.`,
      recommendation: 'Set stricter meeting policies and send reminders earlier.',
      impact: 'Reducing late starts could save hours per month.'
    });
  }
  
  // Missing agendas
  const meetingsWithAgenda = meetings.filter(m => m.agenda && m.agenda.length > 0).length;
  if (meetingsWithAgenda / meetings.length < 0.5) {
    insights.push({
      type: 'missing-agendas',
      severity: 'warning',
      title: 'Many Meetings Lack Agendas',
      description: `${Math.round((1 - meetingsWithAgenda / meetings.length) * 100)}% of meetings have no agenda.`,
      recommendation: 'Require agendas for all meetings to improve focus and outcomes.',
      impact: 'Agendas can improve meeting productivity by up to 30%.'
    });
  }
  
  // Positive trends
  if (scores.productivityScore > 80) {
    insights.push({
      type: 'positive-trend',
      severity: 'info',
      title: 'Great Meeting Practices!',
      description: 'Your meetings are well-organized and productive.',
      recommendation: 'Keep up the good work! Share your practices with your team.',
      impact: 'High productivity meetings lead to better outcomes and team satisfaction.'
    });
  }
  
  return insights;
}

async function calculateActionItemStats(userId, startDate, endDate, ActionItem) {
  const actionItems = await ActionItem.find({
    assignedTo: userId,
    createdAt: { $gte: startDate, $lte: endDate }
  });
  
  const completed = actionItems.filter(ai => ai.status === 'completed').length;
  const overdue = actionItems.filter(ai => ai.isOverdue()).length;
  
  return {
    total: actionItems.length,
    completed,
    overdue,
    completionRate: actionItems.length > 0 ? Math.round((completed / actionItems.length) * 100) : 0,
    averageCompletionTime: 0 // Calculate if needed
  };
}

function calculateFocusTime(meetings, startDate, endDate) {
  // Simplified focus time calculation
  const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const workingHoursPerDay = 8;
  const totalMinutesAvailable = totalDays * workingHoursPerDay * 60;
  
  const totalMeetingMinutes = meetings.reduce((sum, m) => {
    return sum + (m.endTime - m.startTime) / (1000 * 60);
  }, 0);
  
  const minutesProtected = totalMinutesAvailable - totalMeetingMinutes;
  
  return {
    totalMinutesAvailable,
    minutesProtected: Math.max(0, minutesProtected),
    minutesInterrupted: totalMeetingMinutes,
    longestFocusBlock: 120, // Placeholder
    protectionRate: Math.round((minutesProtected / totalMinutesAvailable) * 100)
  };
}

module.exports = mongoose.model('MeetingAnalytics', meetingAnalyticsSchema);
