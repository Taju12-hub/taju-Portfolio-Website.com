<?php
require __DIR__ . '/vendor/autoload.php';

use Workerman\Worker;
use PHPSocketIO\SocketIO;

$port = intval(getenv('PORT') ?: 3000);
$io = new SocketIO($port);

// Allow any origin (development). For production, restrict origins.
$io->origins('*:*');

$io->on('connection', function($socket) use ($io) {
    // Join a room
    $socket->on('join', function($room) use ($socket, $io) {
        $room = (string)$room;
        $socket->join($room);
        // Notify others in the room to start negotiation
        $socket->broadcast->to($room)->emit('ready');
    });

    // Relay SDP offer
    $socket->on('offer', function($data) use ($socket) {
        $room = $data['room'] ?? '';
        $sdp  = $data['sdp'] ?? null;
        if ($room && $sdp) {
            $socket->broadcast->to($room)->emit('offer', $sdp);
        }
    });

    // Relay SDP answer
    $socket->on('answer', function($data) use ($socket) {
        $room = $data['room'] ?? '';
        $sdp  = $data['sdp'] ?? null;
        if ($room && $sdp) {
            $socket->broadcast->to($room)->emit('answer', $sdp);
        }
    });

    // Relay ICE candidate
    $socket->on('candidate', function($data) use ($socket) {
        $room = $data['room'] ?? '';
        $candidate = $data['candidate'] ?? null;
        if ($room && $candidate) {
            $socket->broadcast->to($room)->emit('candidate', $candidate);
        }
    });

    // Leave room
    $socket->on('leave', function($room) use ($socket) {
        $room = (string)$room;
        $socket->leave($room);
        $socket->broadcast->to($room)->emit('leave');
    });

    // Simple room chat relay
    $socket->on('chat-message', function($data) use ($socket) {
        $room = $data['room'] ?? '';
        if ($room) {
            $socket->broadcast->to($room)->emit('chat-message', [
                'from' => $data['from'] ?? 'Peer',
                'text' => $data['text'] ?? ''
            ]);
        }
    });
});

// Run worker
Worker::runAll();
