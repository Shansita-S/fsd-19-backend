const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const MeetingAnalytics = require('../models/MeetingAnalytics');
const Meeting = require('../models/Meeting');
const User = require('../models/User');

// @route   GET /api/analytics/dashboard
// @desc    Get comprehensive analytics dashboard
// @access  Private
router.get('/dashboard', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const { period = 'monthly' } = req.query;
    
    // Determine date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'daily':
        startDate.setDate(endDate.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'quarterly':
        startDate.setMonth(endDate.getMonth() - 3);
        break;
      case 'yearly':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
    }
    
    // Check if analytics already exist
    let analytics = await MeetingAnalytics.findOne({
      user: userId,
      period,
      startDate: { $lte: startDate },
      endDate: { $gte: endDate }
    });
    
    // Generate if not exists or outdated
    if (!analytics || analytics.updatedAt < new Date(Date.now() - 3600000)) { // 1 hour cache
      analytics = await MeetingAnalytics.generateAnalytics(userId, period, startDate, endDate);
    }
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Get analytics dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
});

// @route   GET /api/analytics/health-score
// @desc    Get meeting health score with breakdown
// @access  Private
router.get('/health-score', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Get recent meetings for detailed analysis
    const recentMeetings = await Meeting.find({
      $or: [
        { organizer: req.user._id },
        { 'participants.user': req.user._id }
      ],
      startTime: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    }).sort({ startTime: -1 }).limit(50);
    
    // Calculate detailed breakdown
    const breakdown = {
      meetingFrequency: calculateMeetingFrequencyScore(recentMeetings),
      meetingDuration: calculateDurationScore(recentMeetings),
      punctuality: calculatePunctualityScore(recentMeetings),
      preparation: calculatePreparationScore(recentMeetings),
      followThrough: calculateFollowThroughScore(recentMeetings)
    };
    
    const overallScore = Math.round(
      (breakdown.meetingFrequency + 
       breakdown.meetingDuration + 
       breakdown.punctuality + 
       breakdown.preparation + 
       breakdown.followThrough) / 5
    );
    
    res.json({
      success: true,
      data: {
        overallScore,
        breakdown,
        recommendations: generateHealthRecommendations(breakdown),
        trend: user.analytics.meetingHealthScore > overallScore ? 'declining' : 'improving'
      }
    });
  } catch (error) {
    console.error('Get health score error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate health score',
      error: error.message
    });
  }
});

// @route   GET /api/analytics/productivity
// @desc    Get productivity insights and recommendations
// @access  Private
router.get('/productivity', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get meetings from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const meetings = await Meeting.find({
      $or: [
        { organizer: userId },
        { 'participants.user': userId }
      ],
      startTime: { $gte: thirtyDaysAgo },
      status: 'completed'
    });
    
    // Calculate productivity metrics
    const productivityMetrics = {
      totalMeetingTime: meetings.reduce((sum, m) => 
        sum + (m.endTime - m.startTime) / (1000 * 60), 0),
      averageProductivityScore: meetings.reduce((sum, m) => 
        sum + (m.analytics?.productivityScore || 0), 0) / meetings.length || 0,
      meetingsWithAgenda: meetings.filter(m => m.agenda && m.agenda.length > 0).length,
      meetingsWithActionItems: meetings.filter(m => m.actionItems && m.actionItems.length > 0).length,
      averageAttendanceRate: meetings.reduce((sum, m) => 
        sum + (m.analytics?.attendanceRate || 100), 0) / meetings.length || 100,
      focusTimeAvailable: calculateFocusTimeAvailable(meetings)
    };
    
    // Generate insights
    const insights = generateProductivityInsights(productivityMetrics, meetings);
    
    res.json({
      success: true,
      data: {
        metrics: productivityMetrics,
        insights,
        recommendations: generateProductivityRecommendations(productivityMetrics)
      }
    });
  } catch (error) {
    console.error('Get productivity insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch productivity insights',
      error: error.message
    });
  }
});

// @route   GET /api/analytics/trends
// @desc    Get meeting trends and patterns
// @access  Private
router.get('/trends', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get meetings for the last 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const meetings = await Meeting.find({
      $or: [
        { organizer: userId },
        { 'participants.user': userId }
      ],
      startTime: { $gte: threeMonthsAgo }
    }).sort({ startTime: 1 });
    
    // Group by week
    const weeklyTrends = groupMeetingsByWeek(meetings);
    const hourlyDistribution = analyzeHourlyDistribution(meetings);
    const typeDistribution = analyzeTypeDistribution(meetings);
    const durationTrends = analyzeDurationTrends(meetings);
    
    res.json({
      success: true,
      data: {
        weeklyTrends,
        hourlyDistribution,
        typeDistribution,
        durationTrends,
        predictions: generatePredictions(weeklyTrends)
      }
    });
  } catch (error) {
    console.error('Get trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trends',
      error: error.message
    });
  }
});

// @route   POST /api/analytics/generate
// @desc    Force regenerate analytics for a period
// @access  Private
router.post('/generate', protect, async (req, res) => {
  try {
    const { period = 'monthly' } = req.body;
    
    const endDate = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'weekly':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'quarterly':
        startDate.setMonth(endDate.getMonth() - 3);
        break;
    }
    
    const analytics = await MeetingAnalytics.generateAnalytics(
      req.user._id,
      period,
      startDate,
      endDate
    );
    
    res.json({
      success: true,
      message: 'Analytics generated successfully',
      data: analytics
    });
  } catch (error) {
    console.error('Generate analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate analytics',
      error: error.message
    });
  }
});

// Helper functions
function calculateMeetingFrequencyScore(meetings) {
  const meetingsPerWeek = (meetings.length / 4) || 0;
  if (meetingsPerWeek <= 10) return 100;
  if (meetingsPerWeek <= 15) return 80;
  if (meetingsPerWeek <= 20) return 60;
  if (meetingsPerWeek <= 25) return 40;
  return 20;
}

function calculateDurationScore(meetings) {
  const avgDuration = meetings.reduce((sum, m) => 
    sum + (m.endTime - m.startTime) / (1000 * 60), 0) / meetings.length || 0;
  
  if (avgDuration <= 30) return 100;
  if (avgDuration <= 45) return 90;
  if (avgDuration <= 60) return 80;
  if (avgDuration <= 90) return 60;
  return 40;
}

function calculatePunctualityScore(meetings) {
  const lateStarts = meetings.filter(m => m.analytics?.lateStartMinutes > 0).length;
  const punctualityRate = ((meetings.length - lateStarts) / meetings.length) * 100 || 100;
  return Math.round(punctualityRate);
}

function calculatePreparationScore(meetings) {
  const withAgenda = meetings.filter(m => m.agenda && m.agenda.length > 0).length;
  const preparationRate = (withAgenda / meetings.length) * 100 || 0;
  return Math.round(preparationRate);
}

function calculateFollowThroughScore(meetings) {
  const withActionItems = meetings.filter(m => m.actionItems && m.actionItems.length > 0).length;
  const followThroughRate = (withActionItems / meetings.length) * 100 || 0;
  return Math.round(followThroughRate);
}

function generateHealthRecommendations(breakdown) {
  const recommendations = [];
  
  if (breakdown.meetingFrequency < 70) {
    recommendations.push('Reduce meeting frequency - consider async communication');
  }
  if (breakdown.preparation < 70) {
    recommendations.push('Require agendas for all meetings');
  }
  if (breakdown.punctuality < 80) {
    recommendations.push('Improve time management - start meetings on time');
  }
  if (breakdown.followThrough < 60) {
    recommendations.push('Create action items to improve meeting outcomes');
  }
  
  return recommendations;
}

function calculateFocusTimeAvailable(meetings) {
  // Calculate blocks of time between meetings
  // Simplified calculation
  return {
    totalMinutes: 2400, // Approximately 40 hours per week
    usedByMeetings: meetings.reduce((sum, m) => 
      sum + (m.endTime - m.startTime) / (1000 * 60), 0),
    protectedPercentage: 60
  };
}

function generateProductivityInsights(metrics, meetings) {
  const insights = [];
  
  if (metrics.averageProductivityScore > 80) {
    insights.push({
      type: 'positive',
      message: 'Your meetings are highly productive!',
      icon: '🎉'
    });
  }
  
  if (metrics.meetingsWithAgenda / meetings.length < 0.5) {
    insights.push({
      type: 'warning',
      message: 'Many meetings lack agendas - this reduces effectiveness',
      icon: '⚠️'
    });
  }
  
  if (metrics.totalMeetingTime > 1200) {
    insights.push({
      type: 'critical',
      message: 'You\'re spending too much time in meetings',
      icon: '🔴'
    });
  }
  
  return insights;
}

function generateProductivityRecommendations(metrics) {
  const recommendations = [];
  
  if (metrics.totalMeetingTime > 1000) {
    recommendations.push({
      title: 'Reduce Meeting Time',
      description: 'Try to cut 20% of meeting time by making them shorter or less frequent',
      impact: 'High',
      effort: 'Medium'
    });
  }
  
  if (metrics.meetingsWithAgenda < metrics.totalMeetingTime / 60) {
    recommendations.push({
      title: 'Add Agendas to All Meetings',
      description: 'Require an agenda before accepting any meeting invitation',
      impact: 'High',
      effort: 'Low'
    });
  }
  
  return recommendations;
}

function groupMeetingsByWeek(meetings) {
  const weeks = {};
  
  meetings.forEach(meeting => {
    const weekStart = getWeekStart(meeting.startTime);
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeks[weekKey]) {
      weeks[weekKey] = {
        count: 0,
        totalMinutes: 0,
        meetings: []
      };
    }
    
    weeks[weekKey].count++;
    weeks[weekKey].totalMinutes += (meeting.endTime - meeting.startTime) / (1000 * 60);
    weeks[weekKey].meetings.push(meeting._id);
  });
  
  return Object.entries(weeks).map(([week, data]) => ({
    week,
    ...data
  }));
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function analyzeHourlyDistribution(meetings) {
  const hours = Array(24).fill(0);
  
  meetings.forEach(meeting => {
    const hour = new Date(meeting.startTime).getHours();
    hours[hour]++;
  });
  
  return hours.map((count, hour) => ({ hour, count }));
}

function analyzeTypeDistribution(meetings) {
  const types = {};
  
  meetings.forEach(meeting => {
    const type = meeting.type || 'team';
    types[type] = (types[type] || 0) + 1;
  });
  
  return Object.entries(types).map(([type, count]) => ({ type, count }));
}

function analyzeDurationTrends(meetings) {
  const durations = meetings.map(m => ({
    date: m.startTime,
    duration: (m.endTime - m.startTime) / (1000 * 60)
  }));
  
  return durations;
}

function generatePredictions(weeklyTrends) {
  if (weeklyTrends.length < 4) return null;
  
  const recent = weeklyTrends.slice(-4);
  const avgMeetings = recent.reduce((sum, week) => sum + week.count, 0) / recent.length;
  
  return {
    nextWeekMeetings: Math.round(avgMeetings),
    trend: recent[3].count > recent[0].count ? 'increasing' : 'decreasing'
  };
}

module.exports = router;
