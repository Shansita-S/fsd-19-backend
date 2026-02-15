const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Meeting = require('../models/Meeting');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// @route   POST /api/meetings
// @desc    Create a new meeting
// @access  Private (ORGANIZER only)
router.post('/', protect, authorize('ORGANIZER'), [
  body('title').trim().notEmpty().withMessage('Meeting title is required'),
  body('startTime').isISO8601().withMessage('Valid start time is required'),
  body('endTime').isISO8601().withMessage('Valid end time is required'),
  body('participants').isArray().withMessage('Participants must be an array')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { title, description, startTime, endTime, participants } = req.body;

    // Convert to Date objects
    const start = new Date(startTime);
    const end = new Date(endTime);

    // Validate time range
    if (end <= start) {
      return res.status(400).json({ 
        success: false, 
        message: 'End time must be after start time' 
      });
    }

    // Check if start time is in the past
    if (start < new Date()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot schedule meetings in the past' 
      });
    }

    // Verify all participants exist and are PARTICIPANT role
    if (participants && participants.length > 0) {
      const participantUsers = await User.find({ 
        _id: { $in: participants },
        role: 'PARTICIPANT'
      });

      if (participantUsers.length !== participants.length) {
        return res.status(400).json({ 
          success: false, 
          message: 'One or more participants are invalid' 
        });
      }

      // Check for conflicts for each participant
      const conflicts = [];
      for (const participantId of participants) {
        const conflictingMeetings = await Meeting.checkParticipantConflict(
          participantId,
          start,
          end
        );

        if (conflictingMeetings.length > 0) {
          const participant = participantUsers.find(p => p._id.toString() === participantId);
          conflicts.push({
            participant: {
              id: participant._id,
              name: participant.name,
              email: participant.email
            },
            conflictingMeetings: conflictingMeetings.map(m => ({
              id: m._id,
              title: m.title,
              startTime: m.startTime,
              endTime: m.endTime,
              organizer: m.organizer ? {
                name: m.organizer.name,
                email: m.organizer.email
              } : null
            }))
          });
        }
      }

      // If there are conflicts, find alternative time slots
      if (conflicts.length > 0) {
        // Calculate meeting duration in minutes
        const durationMinutes = (end - start) / (1000 * 60);
        
        // Find suggested alternative slots
        const suggestedSlots = await Meeting.findBestCommonSlot(
          participants,
          durationMinutes,
          7 // Search next 7 days
        );
        
        return res.status(409).json({ 
          success: false, 
          message: 'Scheduling conflict detected. One or more participants have overlapping meetings.',
          conflicts,
          suggestedSlots: suggestedSlots || []
        });
      }
    }

    // Create meeting with proper participant structure
    const meeting = new Meeting({
      title,
      description,
      startTime: start,
      endTime: end,
      organizer: req.user._id,
      participants: (participants || []).map(userId => ({
        user: new mongoose.Types.ObjectId(userId),
        status: 'pending'
      }))
    });
    
    await meeting.save();

    // Populate organizer and participants
    await meeting.populate('organizer', 'name email');
    await meeting.populate('participants.user', 'name email');

    res.status(201).json({
      success: true,
      message: 'Meeting created successfully',
      meeting
    });
  } catch (error) {
    console.error('Create meeting error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during meeting creation',
      error: error.message
    });
  }
});

// @route   GET /api/meetings
// @desc    Get meetings (based on user role)
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    let meetings;

    if (req.user.role === 'ORGANIZER') {
      // Organizers see all meetings they created
      meetings = await Meeting.find({ organizer: req.user._id })
        .populate('organizer', 'name email')
        .populate('participants.user', 'name email')
        .sort('-startTime');
    } else {
      // Participants see only meetings they are invited to
      meetings = await Meeting.find({ 'participants.user': req.user._id })
        .populate('organizer', 'name email')
        .populate('participants.user', 'name email')
        .sort('-startTime');
    }

    res.status(200).json({
      success: true,
      count: meetings.length,
      meetings
    });
  } catch (error) {
    console.error('Get meetings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/meetings/:id
// @desc    Get single meeting
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id)
      .populate('organizer', 'name email')
      .populate('participants.user', 'name email');

    if (!meeting) {
      return res.status(404).json({ 
        success: false, 
        message: 'Meeting not found' 
      });
    }

    // Check if user has access to this meeting
    const isOrganizer = meeting.organizer._id.toString() === req.user._id.toString();
    const isParticipant = meeting.participants.some(
      p => p.user && p.user._id.toString() === req.user._id.toString()
    );

    if (!isOrganizer && !isParticipant) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to view this meeting' 
      });
    }

    res.status(200).json({
      success: true,
      meeting
    });
  } catch (error) {
    console.error('Get meeting error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   POST /api/meetings/find-best-slot
// @desc    Find best available slot for all participants (Auto-Schedule)
// @access  Private (ORGANIZER only)
router.post('/find-best-slot', protect, authorize('ORGANIZER'), [
  body('participants').isArray().withMessage('Participants must be an array'),
  body('duration').isInt({ min: 15, max: 480 }).withMessage('Duration must be between 15 and 480 minutes')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { participants, duration, daysToSearch = 7 } = req.body;

    // Verify all participants exist and are PARTICIPANT role
    if (participants.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'At least one participant is required' 
      });
    }

    const participantUsers = await User.find({ 
      _id: { $in: participants },
      role: 'PARTICIPANT'
    });

    if (participantUsers.length !== participants.length) {
      return res.status(400).json({ 
        success: false, 
        message: 'One or more participants are invalid' 
      });
    }

    // Find best common slots
    const suggestedSlots = await Meeting.findBestCommonSlot(
      participants,
      duration,
      daysToSearch
    );

    if (!suggestedSlots || suggestedSlots.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No available slots found in the next ' + daysToSearch + ' days. Try extending the search period.' 
      });
    }

    res.status(200).json({
      success: true,
      message: 'Found ' + suggestedSlots.length + ' available slot(s)',
      suggestedSlots
    });
  } catch (error) {
    console.error('Find best slot error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   PUT /api/meetings/:id
// @desc    Update meeting
// @access  Private (ORGANIZER only - own meetings)
router.put('/:id', protect, authorize('ORGANIZER'), [
  body('title').optional().trim().notEmpty().withMessage('Meeting title cannot be empty'),
  body('startTime').optional().isISO8601().withMessage('Valid start time is required'),
  body('endTime').optional().isISO8601().withMessage('Valid end time is required'),
  body('participants').optional().isArray().withMessage('Participants must be an array')
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ 
        success: false, 
        message: 'Meeting not found' 
      });
    }

    // Check if user is the organizer
    if (meeting.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this meeting' 
      });
    }

    const { title, description, startTime, endTime, participants } = req.body;

    // Prepare update data
    const updateData = {};
    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;

    // Handle time updates
    const start = startTime ? new Date(startTime) : meeting.startTime;
    const end = endTime ? new Date(endTime) : meeting.endTime;

    if (end <= start) {
      return res.status(400).json({ 
        success: false, 
        message: 'End time must be after start time' 
      });
    }

    if (start < new Date()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot schedule meetings in the past' 
      });
    }

    updateData.startTime = start;
    updateData.endTime = end;

    // Handle participants update
    if (participants !== undefined) {
      if (participants.length > 0) {
        const participantUsers = await User.find({ 
          _id: { $in: participants },
          role: 'PARTICIPANT'
        });

        if (participantUsers.length !== participants.length) {
          return res.status(400).json({ 
            success: false, 
            message: 'One or more participants are invalid' 
          });
        }

        // Check for conflicts
        const conflicts = [];
        for (const participantId of participants) {
          const conflictingMeetings = await Meeting.checkParticipantConflict(
            participantId,
            start,
            end,
            meeting._id // Exclude current meeting
          );

          if (conflictingMeetings.length > 0) {
            const participant = participantUsers.find(p => p._id.toString() === participantId);
            conflicts.push({
              participant: {
                id: participant._id,
                name: participant.name,
                email: participant.email
              },
              conflictingMeetings: conflictingMeetings.map(m => ({
                id: m._id,
                title: m.title,
                startTime: m.startTime,
                endTime: m.endTime,
                organizer: m.organizer ? {
                  name: m.organizer.name,
                  email: m.organizer.email
                } : null
              }))
            });
          }
        }

        if (conflicts.length > 0) {
          // Calculate meeting duration in minutes
          const durationMinutes = (end - start) / (1000 * 60);
          
          // Find suggested alternative slots
          const suggestedSlots = await Meeting.findBestCommonSlot(
            participants,
            durationMinutes,
            7 // Search next 7 days
          );
          
          return res.status(409).json({ 
            success: false, 
            message: 'Scheduling conflict detected. One or more participants have overlapping meetings.',
            conflicts,
            suggestedSlots: suggestedSlots || []
          });
        }
      }
      
      updateData.participants = participants.map(userId => ({
        user: new mongoose.Types.ObjectId(userId),
        status: 'pending'
      }));
    }

    // Update meeting
    const updatedMeeting = await Meeting.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('organizer', 'name email')
      .populate('participants.user', 'name email');

    res.status(200).json({
      success: true,
      message: 'Meeting updated successfully',
      meeting: updatedMeeting
    });
  } catch (error) {
    console.error('Update meeting error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during meeting update',
      error: error.message
    });
  }
});

// @route   DELETE /api/meetings/:id
// @desc    Delete meeting
// @access  Private (ORGANIZER only - own meetings)
router.delete('/:id', protect, authorize('ORGANIZER'), async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ 
        success: false, 
        message: 'Meeting not found' 
      });
    }

    // Check if user is the organizer
    if (meeting.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to delete this meeting' 
      });
    }

    await meeting.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Meeting deleted successfully'
    });
  } catch (error) {
    console.error('Delete meeting error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   POST /api/meetings/smart-schedule
// @desc    Find optimal meeting times using AI
// @access  Private (ORGANIZER only)
router.post('/smart-schedule', protect, authorize('ORGANIZER'), async (req, res) => {
  try {
    const { participants, duration = 60, startDate, endDate } = req.body;
    
    if (!participants || participants.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Participants are required'
      });
    }
    
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    
    const optimalTimes = await Meeting.findOptimalTimes(
      participants,
      duration,
      start,
      end
    );
    
    res.json({
      success: true,
      message: 'Optimal meeting times found',
      data: optimalTimes
    });
  } catch (error) {
    console.error('Smart schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to find optimal times',
      error: error.message
    });
  }
});

// @route   POST /api/meetings/:id/agenda
// @desc    Add agenda items to a meeting
// @access  Private (ORGANIZER only)
router.post('/:id/agenda', protect, authorize('ORGANIZER'), async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    if (meeting.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }
    
    const { agendaItems } = req.body;
    meeting.agenda = agendaItems.map((item, index) => ({
      ...item,
      order: index
    }));
    
    await meeting.save();
    
    res.json({
      success: true,
      message: 'Agenda updated successfully',
      data: meeting.agenda
    });
  } catch (error) {
    console.error('Update agenda error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update agenda',
      error: error.message
    });
  }
});

// @route   POST /api/meetings/:id/notes
// @desc    Add notes to a meeting
// @access  Private
router.post('/:id/notes', protect, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    // Check access
    const isOrganizer = meeting.organizer.toString() === req.user._id.toString();
    const isParticipant = meeting.participants.some(
      p => p.user && p.user.toString() === req.user._id.toString()
    );
    
    if (!isOrganizer && !isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }
    
    const { content, isPrivate = false } = req.body;
    
    meeting.notes.push({
      content,
      author: req.user._id,
      isPrivate
    });
    
    await meeting.save();
    await meeting.populate('notes.author', 'name email');
    
    res.json({
      success: true,
      message: 'Note added successfully',
      data: meeting.notes[meeting.notes.length - 1]
    });
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add note',
      error: error.message
    });
  }
});

// @route   POST /api/meetings/:id/feedback
// @desc    Submit feedback for a meeting
// @access  Private
router.post('/:id/feedback', protect, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    // Check if already submitted feedback
    const existingFeedback = meeting.feedback.find(
      f => f.participant && f.participant.toString() === req.user._id.toString()
    );
    
    if (existingFeedback) {
      return res.status(400).json({
        success: false,
        message: 'Feedback already submitted'
      });
    }
    
    const { rating, comment, helpful, productive } = req.body;
    
    meeting.feedback.push({
      participant: req.user._id,
      rating,
      comment,
      helpful,
      productive,
      submittedAt: new Date()
    });
    
    // Recalculate productivity score
    meeting.analytics = meeting.analytics || {};
    meeting.analytics.productivityScore = meeting.calculateProductivityScore();
    
    await meeting.save();
    
    res.json({
      success: true,
      message: 'Feedback submitted successfully'
    });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: error.message
    });
  }
});

// @route   PUT /api/meetings/:id/status
// @desc    Update meeting status
// @access  Private (ORGANIZER only)
router.put('/:id/status', protect, authorize('ORGANIZER'), async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    if (meeting.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }
    
    const { status } = req.body;
    
    meeting.status = status;
    
    if (status === 'in-progress' && !meeting.analytics.actualStartTime) {
      meeting.analytics.actualStartTime = new Date();
      
      const scheduledStart = new Date(meeting.startTime);
      const actualStart = new Date();
      meeting.analytics.lateStartMinutes = Math.max(0, Math.floor((actualStart - scheduledStart) / (1000 * 60)));
    }
    
    if (status === 'completed' && !meeting.analytics.actualEndTime) {
      meeting.analytics.actualEndTime = new Date();
      
      const scheduledEnd = new Date(meeting.endTime);
      const actualEnd = new Date();
      meeting.analytics.overrunMinutes = Math.max(0, Math.floor((actualEnd - scheduledEnd) / (1000 * 60)));
      
      meeting.analytics.actualDuration = Math.floor(
        (meeting.analytics.actualEndTime - meeting.analytics.actualStartTime) / (1000 * 60)
      );
      
      meeting.analytics.productivityScore = meeting.calculateProductivityScore();
    }
    
    await meeting.save();
    
    res.json({
      success: true,
      message: 'Meeting status updated',
      data: meeting
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message
    });
  }
});

// @route   PUT /api/meetings/:id/respond
// @desc    Respond to meeting invitation (accept/decline/tentative)
// @access  Private (PARTICIPANT only)
router.put('/:id/respond', protect, authorize('PARTICIPANT'), async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    const { response } = req.body; // 'accepted', 'declined', 'tentative'
    
    const participantIndex = meeting.participants.findIndex(
      p => p.user && p.user.toString() === req.user._id.toString()
    );
    
    if (participantIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'You are not invited to this meeting'
      });
    }
    
    meeting.participants[participantIndex].status = response;
    meeting.participants[participantIndex].responseTime = new Date();
    
    await meeting.save();
    
    // Create notification for organizer
    const Notification = require('../models/Notification');
    await Notification.create({
      recipient: meeting.organizer,
      type: response === 'accepted' ? 'participant-accepted' : 'participant-declined',
      title: `Meeting Response: ${response}`,
      message: `${req.user.name} has ${response} the meeting "${meeting.title}"`,
      priority: 'low',
      meeting: meeting._id
    });
    
    res.json({
      success: true,
      message: `Meeting invitation ${response}`,
      data: meeting
    });
  } catch (error) {
    console.error('Respond to meeting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to respond to meeting',
      error: error.message
    });
  }
});

module.exports = router;
