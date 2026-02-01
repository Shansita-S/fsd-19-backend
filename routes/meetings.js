const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
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

      // If there are conflicts, reject the meeting creation
      if (conflicts.length > 0) {
        return res.status(409).json({ 
          success: false, 
          message: 'Scheduling conflict detected. One or more participants have overlapping meetings.',
          conflicts
        });
      }
    }

    // Create meeting
    const meeting = await Meeting.create({
      title,
      description,
      startTime: start,
      endTime: end,
      organizer: req.user._id,
      participants: participants || []
    });

    // Populate organizer and participants
    await meeting.populate('organizer', 'name email');
    await meeting.populate('participants', 'name email');

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
        .populate('participants', 'name email')
        .sort('-startTime');
    } else {
      // Participants see only meetings they are invited to
      meetings = await Meeting.find({ participants: req.user._id })
        .populate('organizer', 'name email')
        .populate('participants', 'name email')
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
      .populate('participants', 'name email');

    if (!meeting) {
      return res.status(404).json({ 
        success: false, 
        message: 'Meeting not found' 
      });
    }

    // Check if user has access to this meeting
    const isOrganizer = meeting.organizer._id.toString() === req.user._id.toString();
    const isParticipant = meeting.participants.some(
      p => p._id.toString() === req.user._id.toString()
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
          return res.status(409).json({ 
            success: false, 
            message: 'Scheduling conflict detected. One or more participants have overlapping meetings.',
            conflicts
          });
        }
      }
      
      updateData.participants = participants;
    }

    // Update meeting
    const updatedMeeting = await Meeting.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('organizer', 'name email')
      .populate('participants', 'name email');

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

module.exports = router;
