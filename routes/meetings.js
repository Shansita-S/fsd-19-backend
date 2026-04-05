const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { Readable } = require('stream');
const Meeting = require('../models/Meeting');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { protect, authorize } = require('../middleware/auth');

const sanitizeRoomSegment = (value) => {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
};

const buildDefaultJitsiRoom = ({ title, startTime, organizerId }) => {
  const titleSegment = sanitizeRoomSegment(title) || 'meeting';
  const dateSegment = new Date(startTime).toISOString().slice(0, 10).replace(/-/g, '');
  const organizerSegment = String(organizerId).slice(-6);
  const randomSegment = uuidv4().slice(0, 8);
  return `${titleSegment}-${dateSegment}-${organizerSegment}-${randomSegment}`;
};

const buildDefaultJitsiJoinUrl = (roomName) => {
  return `https://meet.jit.si/${roomName}#config.prejoinPageEnabled=false&config.enableWelcomePage=false&config.requireDisplayName=false`;
};

const buildDefaultTalkyJoinUrl = (roomName) => {
  return `https://talky.io/${roomName}`;
};

const resolveBuiltInProvider = () => {
  const provider = (process.env.MEETING_PROVIDER || 'talky').toLowerCase();
  if (provider === 'jitsi') return 'jitsi';
  return 'talky';
};

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

    const { title, description, startTime, endTime, participants, joinUrl, roomName } = req.body;

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

    const computedRoomName = roomName || buildDefaultJitsiRoom({
      title,
      startTime: start,
      organizerId: req.user._id
    });

    const builtInProvider = resolveBuiltInProvider();
    const computedJoinUrl = joinUrl
      || (builtInProvider === 'jitsi'
        ? buildDefaultJitsiJoinUrl(computedRoomName)
        : buildDefaultTalkyJoinUrl(computedRoomName));

    // Create meeting with proper participant structure
    const meeting = new Meeting({
      title,
      description,
      startTime: start,
      endTime: end,
      organizer: req.user._id,
      videoConference: {
        provider: joinUrl ? 'custom' : builtInProvider,
        roomName: computedRoomName,
        joinUrl: computedJoinUrl
      },
      participants: (participants || []).map(userId => ({
        user: new mongoose.Types.ObjectId(userId),
        status: 'pending'
      }))
    });
    
    await meeting.save();

    // Populate organizer and participants
    await meeting.populate('organizer', 'name email');
    await meeting.populate('participants.user', 'name email');

    if (meeting.participants.length > 0) {
      const notifications = meeting.participants.map((participant) => ({
        user: participant.user._id,
        meeting: meeting._id,
        type: 'info',
        message: `You have been invited to "${meeting.title}". Join link: ${meeting.videoConference?.joinUrl || 'TBA'}`
      }));
      await Notification.insertMany(notifications);
    }

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
    await meeting.populate('organizer participants.user', 'name email');
    
    res.json({
      success: true,
      message: 'Agenda updated successfully',
      meeting
    });
  } catch (error) {
    console.error('Add agenda error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add agenda',
      error: error.message
    });
  }
});

// @route   POST /api/meetings/:id/notes
// @desc    Add a note to a meeting
// @access  Private (Anyone in the meeting)
router.post('/:id/notes', protect, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    // Check if user is organizer or participant
    const isOrganizer = meeting.organizer.toString() === req.user._id.toString();
    const isParticipant = meeting.participants.some(
      p => p.user.toString() === req.user._id.toString()
    );
    
    if (!isOrganizer && !isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You must be part of the meeting to add notes'
      });
    }
    
    const { content } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Note content is required'
      });
    }
    
    meeting.notes.push({
      content: content.trim(),
      author: req.user._id,
      createdAt: new Date()
    });
    
    await meeting.save();
    await meeting.populate('organizer participants.user notes.author', 'name email');
    
    res.json({
      success: true,
      message: 'Note added successfully',
      meeting
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

// @route   POST /api/meetings/:id/recording
// @desc    Add recording link and notify participants
// @access  Private (ORGANIZER only - own meeting)
router.post('/:id/recording', protect, authorize('ORGANIZER'), [
  body('recordingUrl')
    .trim()
    .matches(/^https?:\/\/.+/i)
    .withMessage('A valid recording URL is required')
], async (req, res) => {
  try {
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

    if (meeting.organizer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload recording for this meeting'
      });
    }

    const { recordingUrl } = req.body;
    meeting.recording = {
      status: 'available',
      recordingUrl,
      uploadedAt: new Date(),
      uploadedBy: req.user._id
    };

    await meeting.save();
    await meeting.populate('participants.user', 'name email');

    if (meeting.participants.length > 0) {
      const notifications = meeting.participants.map((participant) => ({
        user: participant.user._id,
        meeting: meeting._id,
        type: 'recording',
        message: `Recording is now available for "${meeting.title}": ${recordingUrl}`
      }));
      await Notification.insertMany(notifications);
    }

    res.status(200).json({
      success: true,
      message: 'Recording saved and shared with participants',
      meeting
    });
  } catch (error) {
    console.error('Add recording error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save recording',
      error: error.message
    });
  }
});

// @route   GET /api/meetings/:id/recording/download
// @desc    Download meeting recording for organizer/invited participants
// @access  Private
router.get('/:id/recording/download', protect, async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    const isOrganizer = meeting.organizer.toString() === req.user._id.toString();
    const participantEntry = meeting.participants.find(
      (p) => p.user && p.user.toString() === req.user._id.toString()
    );
    const isEligibleParticipant = Boolean(participantEntry && participantEntry.status !== 'declined');

    if (!isOrganizer && !isEligibleParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to download this recording'
      });
    }

    const recordingUrl = meeting.recording?.recordingUrl;
    if (!recordingUrl) {
      return res.status(404).json({
        success: false,
        message: 'Recording is not available yet'
      });
    }

    if (recordingUrl.includes('recordings.example.com')) {
      return res.status(409).json({
        success: false,
        message: 'This meeting has an old placeholder recording URL. Please update recording URL in meeting details.'
      });
    }

    const upstream = await fetch(recordingUrl);
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({
        success: false,
        message: 'Unable to fetch recording from source'
      });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const safeTitle = String(meeting.title || 'meeting-recording')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'meeting-recording';

    let extension = 'bin';
    if (contentType.includes('mp4')) extension = 'mp4';
    else if (contentType.includes('webm')) extension = 'webm';
    else if (contentType.includes('mpeg')) extension = 'mp3';
    else if (contentType.includes('wav')) extension = 'wav';

    const filename = `${safeTitle}-recording.${extension}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error('Download recording error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download recording',
      error: error.message
    });
  }
});

module.exports = router;
