import React, { useEffect, useState } from 'react';
import { StyleSheet, View, LayoutChangeEvent } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSequence,
    withRepeat,
    Easing,
} from 'react-native-reanimated';
import Svg, { Rect, Circle } from 'react-native-svg';
import { Colors } from '../constants/Colors';

// Fixed body dimensions — no dependency on screen size
const BODY_W = 260;
const BODY_H = 310;

// Screen rect inside the SVG body
const SCREEN_W = BODY_W * 0.68;
const SCREEN_H = BODY_H * 0.40;
const SCREEN_X = (BODY_W - SCREEN_W) / 2;
const SCREEN_Y = BODY_H * 0.09;

export type BmoMood = 'idle' | 'happy' | 'thinking' | 'talking' | 'surprised';

interface BmoFaceProps {
    mood?: BmoMood;
}

const BmoFace = ({ mood = 'idle' }: BmoFaceProps) => {
    const eyeScaleY = useSharedValue(1);
    const mouthOpen = useSharedValue(0);
    const bodyBounce = useSharedValue(0);

    // ── Blink loop ──────────────────────────────────────────────────────────
    useEffect(() => {
        const id = setInterval(() => {
            eyeScaleY.value = withSequence(
                withTiming(0.05, { duration: 80 }),
                withTiming(1, { duration: 80 })
            );
        }, 3500);
        return () => clearInterval(id);
    }, []);

    // ── Mood reactions ───────────────────────────────────────────────────────
    useEffect(() => {
        switch (mood) {
            case 'talking':
                mouthOpen.value = withRepeat(
                    withSequence(
                        withTiming(1, { duration: 140 }),
                        withTiming(0.1, { duration: 140 })
                    ), -1, false
                );
                bodyBounce.value = withRepeat(
                    withTiming(-5, { duration: 280, easing: Easing.inOut(Easing.ease) }),
                    -1, true
                );
                break;
            case 'happy':
                mouthOpen.value = withTiming(0.6, { duration: 200 });
                bodyBounce.value = withRepeat(
                    withTiming(-10, { duration: 380, easing: Easing.inOut(Easing.ease) }),
                    6, true
                );
                break;
            case 'surprised':
                eyeScaleY.value = withSequence(withTiming(1.4, { duration: 100 }), withTiming(1, { duration: 300 }));
                bodyBounce.value = withSequence(withTiming(-16, { duration: 100 }), withTiming(0, { duration: 300 }));
                mouthOpen.value = withSequence(withTiming(1, { duration: 100 }), withTiming(0, { duration: 600 }));
                break;
            case 'thinking':
                mouthOpen.value = withTiming(0, { duration: 200 });
                bodyBounce.value = withRepeat(
                    withTiming(-3, { duration: 900, easing: Easing.inOut(Easing.ease) }),
                    -1, true
                );
                break;
            default: // idle
                mouthOpen.value = withTiming(0, { duration: 200 });
                bodyBounce.value = withRepeat(
                    withTiming(-4, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
                    -1, true
                );
        }
    }, [mood]);

    const eyeAnimStyle = useAnimatedStyle(() => ({
        transform: [{ scaleY: eyeScaleY.value }],
    }));

    const wrapperAnimStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: bodyBounce.value }],
    }));

    const mouthAnimStyle = useAnimatedStyle(() => {
        const open = mouthOpen.value > 0.4;
        return {
            width: SCREEN_W * 0.30,
            height: SCREEN_W * 0.08 + mouthOpen.value * SCREEN_W * 0.14,
            borderBottomWidth: open ? 0 : 4,
            borderWidth: open ? 4 : 0,
            borderColor: Colors.bmoMouth,
            borderBottomLeftRadius: open ? 999 : 18,
            borderBottomRightRadius: open ? 999 : 18,
            borderTopLeftRadius: open ? 999 : 0,
            borderTopRightRadius: open ? 999 : 0,
        };
    });

    const isHappy = mood === 'happy';

    return (
        <Animated.View style={[{ width: BODY_W, height: BODY_H }, wrapperAnimStyle]}>

            {/* ── SVG body ─────────────────────────────────────────────── */}
            <Svg width={BODY_W} height={BODY_H} style={StyleSheet.absoluteFill}>

                {/* Body */}
                <Rect x={0} y={0} width={BODY_W} height={BODY_H} rx={26} ry={26} fill={Colors.bmoBody} />

                {/* Screen shadow/bezel */}
                <Rect
                    x={SCREEN_X - 5} y={SCREEN_Y - 5}
                    width={SCREEN_W + 10} height={SCREEN_H + 10}
                    rx={20} ry={20} fill="rgba(0,0,0,0.18)"
                />
                {/* Screen */}
                <Rect
                    x={SCREEN_X} y={SCREEN_Y}
                    width={SCREEN_W} height={SCREEN_H}
                    rx={16} ry={16} fill={Colors.bmoScreen}
                />

                {/* D-pad vertical */}
                <Rect x={BODY_W * 0.77} y={BODY_H * 0.575} width={BODY_W * 0.07} height={BODY_W * 0.19} rx={4} ry={4} fill="#4a9e8e" />
                {/* D-pad horizontal */}
                <Rect x={BODY_W * 0.74} y={BODY_H * 0.632} width={BODY_W * 0.13} height={BODY_W * 0.065} rx={4} ry={4} fill="#4a9e8e" />

                {/* A button (red) */}
                <Circle cx={BODY_W * 0.83} cy={BODY_H * 0.815} r={BODY_W * 0.052} fill="#E85D75" />
                {/* B button (blue) */}
                <Circle cx={BODY_W * 0.71} cy={BODY_H * 0.848} r={BODY_W * 0.038} fill="#5B8DD9" />

                {/* Speaker dots */}
                <Circle cx={BODY_W * 0.17} cy={BODY_H * 0.60} r={3} fill="#4a9e8e" />
                <Circle cx={BODY_W * 0.24} cy={BODY_H * 0.60} r={3} fill="#4a9e8e" />
                <Circle cx={BODY_W * 0.17} cy={BODY_H * 0.645} r={3} fill="#4a9e8e" />
                <Circle cx={BODY_W * 0.24} cy={BODY_H * 0.645} r={3} fill="#4a9e8e" />
                <Circle cx={BODY_W * 0.17} cy={BODY_H * 0.690} r={3} fill="#4a9e8e" />
                <Circle cx={BODY_W * 0.24} cy={BODY_H * 0.690} r={3} fill="#4a9e8e" />

                {/* Select / Start */}
                <Rect x={BODY_W * 0.27} y={BODY_H * 0.825} width={BODY_W * 0.14} height={BODY_W * 0.052} rx={5} ry={5} fill="#4a9e8e" />
                <Rect x={BODY_W * 0.45} y={BODY_H * 0.825} width={BODY_W * 0.14} height={BODY_W * 0.052} rx={5} ry={5} fill="#4a9e8e" />

                {/* Feet */}
                <Rect x={BODY_W * 0.10} y={BODY_H * 0.935} width={BODY_W * 0.30} height={BODY_H * 0.065} rx={12} ry={12} fill="#5aab9b" />
                <Rect x={BODY_W * 0.60} y={BODY_H * 0.935} width={BODY_W * 0.30} height={BODY_H * 0.065} rx={12} ry={12} fill="#5aab9b" />
            </Svg>

            {/* ── Animated face — sits exactly over the screen rect ────── */}
            <View
                style={{
                    position: 'absolute',
                    left: SCREEN_X,
                    top: SCREEN_Y,
                    width: SCREEN_W,
                    height: SCREEN_H,
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                {/* Eyes */}
                <View style={styles.eyesRow}>
                    <Animated.View style={[
                        styles.eye,
                        isHappy ? styles.eyeHappy : styles.eyeNormal,
                        eyeAnimStyle,
                    ]} />
                    <Animated.View style={[
                        styles.eye,
                        isHappy ? styles.eyeHappy : styles.eyeNormal,
                        eyeAnimStyle,
                    ]} />
                </View>

                {/* Blush */}
                <View style={[styles.blushRow, { width: SCREEN_W * 0.85 }]}>
                    <View style={[styles.blush, { width: SCREEN_W * 0.16, height: SCREEN_W * 0.07 }]} />
                    <View style={[styles.blush, { width: SCREEN_W * 0.16, height: SCREEN_W * 0.07 }]} />
                </View>

                {/* Mouth */}
                <Animated.View style={mouthAnimStyle} />
            </View>

        </Animated.View>
    );
};

const styles = StyleSheet.create({
    eyesRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '60%',
        marginBottom: 10,
    },
    eye: {
        backgroundColor: Colors.bmoEye,
    },
    eyeNormal: {
        width: SCREEN_W * 0.13,
        height: SCREEN_W * 0.13,
        borderRadius: 999,
    },
    eyeHappy: {
        width: SCREEN_W * 0.13,
        height: SCREEN_W * 0.065,
        borderTopLeftRadius: 999,
        borderTopRightRadius: 999,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
    },
    blushRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        position: 'absolute',
        bottom: SCREEN_H * 0.22,
    },
    blush: {
        backgroundColor: Colors.bmoBlush,
        borderRadius: 10,
        opacity: 0.55,
    },
});

export default BmoFace;