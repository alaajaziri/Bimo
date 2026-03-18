import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSequence,
    withRepeat,
    Easing,
} from 'react-native-reanimated';
import Svg, { Rect, Circle, Polygon, Text as SvgText } from 'react-native-svg';
import { Colors } from '../constants/Colors';

// Fixed body/screen metrics shared with chat/game overlay layout.
export const BMO_BODY_W = 272;
export const BMO_BODY_H = 328;

export const BMO_SCREEN_W = Math.floor(BMO_BODY_W * 0.66);
export const BMO_SCREEN_H = Math.floor(BMO_BODY_H * 0.39);
export const BMO_SCREEN_X = Math.floor((BMO_BODY_W - BMO_SCREEN_W) / 2);
export const BMO_SCREEN_Y = Math.floor(BMO_BODY_H * 0.105);

export type BmoMood = 'idle' | 'happy' | 'thinking' | 'talking' | 'surprised';

interface BmoFaceProps {
    mood?: BmoMood;
    onDpadUp?: () => void;
    onDpadDown?: () => void;
    onDpadLeft?: () => void;
    onDpadRight?: () => void;
    onActionA?: () => void;
    onActionB?: () => void;
}

const BmoFace = ({
    mood = 'idle',
    onDpadUp,
    onDpadDown,
    onDpadLeft,
    onDpadRight,
    onActionA,
    onActionB,
}: BmoFaceProps) => {
    const eyeScaleY = useSharedValue(1);
    const mouthOpen = useSharedValue(0);
    const bodyBounce = useSharedValue(0);

    useEffect(() => {
        const id = setInterval(() => {
            eyeScaleY.value = withSequence(
                withTiming(0.05, { duration: 80 }),
                withTiming(1, { duration: 80 })
            );
        }, 3500);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        switch (mood) {
            case 'talking':
                mouthOpen.value = withRepeat(
                    withSequence(
                        withTiming(1, { duration: 140 }),
                        withTiming(0.1, { duration: 140 })
                    ),
                    -1,
                    false
                );
                bodyBounce.value = withRepeat(
                    withTiming(-5, { duration: 280, easing: Easing.inOut(Easing.ease) }),
                    -1,
                    true
                );
                break;
            case 'happy':
                mouthOpen.value = withTiming(0.6, { duration: 200 });
                bodyBounce.value = withRepeat(
                    withTiming(-10, { duration: 380, easing: Easing.inOut(Easing.ease) }),
                    6,
                    true
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
                    -1,
                    true
                );
                break;
            default:
                mouthOpen.value = withTiming(0, { duration: 200 });
                bodyBounce.value = withRepeat(
                    withTiming(-4, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
                    -1,
                    true
                );
        }
    }, [mood]);

    const eyeAnimStyle = useAnimatedStyle(() => ({
        transform: [{ scaleY: eyeScaleY.value }],
    }));

    const wrapperAnimStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: bodyBounce.value }],
    }));

    const mouthAnimStyle = useAnimatedStyle(() => ({
        transform: [
            { scaleX: 0.94 + mouthOpen.value * 0.08 },
            { scaleY: 0.75 + mouthOpen.value * 0.7 },
        ],
        opacity: 0.88 + mouthOpen.value * 0.12,
    }));

    const isHappy = mood === 'happy';
    const isIdle = mood === 'idle';
    const isThinking = mood === 'thinking';
    const isSurprised = mood === 'surprised';
    const isTalking = mood === 'talking';

    return (
        <Animated.View style={[{ width: BMO_BODY_W, height: BMO_BODY_H }, wrapperAnimStyle]}>
            <Svg width={BMO_BODY_W} height={BMO_BODY_H} style={StyleSheet.absoluteFill}>
                {/* Main shell */}
                <Rect x={18} y={6} width={236} height={288} rx={20} ry={20} fill="#7bd1c1" />
                <Rect x={22} y={10} width={228} height={280} rx={16} ry={16} fill="none" stroke="#4f978a" strokeWidth={2.4} />

                {/* Side strip and label */}
                <Rect x={18} y={35} width={18} height={205} rx={9} ry={9} fill="#6ab5ab" />
                <SvgText
                    x={32}
                    y={170}
                    fill="#1e2f53"
                    fontSize="18"
                    fontWeight="900"
                    transform="rotate(90 32 170)"
                >
                    BMO
                </SvgText>
                <Circle cx={31} cy={196} r={6} fill="#24375f" />
                <Rect x={27} y={200} width={8} height={30} rx={4} ry={4} fill="#5d93b1" />

                {/* Top details */}
                <Rect x={108} y={22} width={56} height={8} rx={4} ry={4} fill="#4f978a" />
                <Circle cx={29} cy={26} r={3.2} fill="#4b9185" />
                <Circle cx={243} cy={26} r={3.2} fill="#4b9185" />
                <Circle cx={29} cy={286} r={3.2} fill="#4b9185" />
                <Circle cx={243} cy={286} r={3.2} fill="#4b9185" />
                <Circle cx={42} cy={38} r={1.8} fill="#376f67" />
                <Circle cx={48} cy={38} r={1.8} fill="#376f67" />
                <Circle cx={54} cy={38} r={1.8} fill="#376f67" />
                <Circle cx={42} cy={44} r={1.8} fill="#376f67" />
                <Circle cx={48} cy={44} r={1.8} fill="#376f67" />
                <Circle cx={54} cy={44} r={1.8} fill="#376f67" />

                <Rect
                    x={BMO_SCREEN_X - 7}
                    y={BMO_SCREEN_Y - 7}
                    width={BMO_SCREEN_W + 14}
                    height={BMO_SCREEN_H + 14}
                    rx={20}
                    ry={20}
                    fill="rgba(0,0,0,0.22)"
                />
                <Rect x={BMO_SCREEN_X} y={BMO_SCREEN_Y} width={BMO_SCREEN_W} height={BMO_SCREEN_H} rx={15} ry={15} fill={Colors.bmoScreen} />

                {/* Controls */}
                <Rect x={82} y={198} width={28} height={74} rx={7} ry={7} fill="#f2d33f" />
                <Rect x={59} y={221} width={74} height={28} rx={7} ry={7} fill="#f2d33f" />
                <Circle cx={96} cy={235} r={7} fill="#c9ac30" />

                <Polygon points="134,232 150,206 166,232" fill="#49c9e0" stroke="#2d95a7" strokeWidth={2.2} />
                <Circle cx={199} cy={214} r={10.5} fill="#5ccc69" stroke="#2e8f40" strokeWidth={2.2} />
                <Circle cx={176} cy={246} r={13} fill="#e53d64" stroke="#a72a46" strokeWidth={2.4} />

                {/* Legs */}
                <Rect x={93} y={292} width={10} height={30} rx={5} ry={5} fill="#4c7cb0" />
                <Rect x={169} y={292} width={10} height={30} rx={5} ry={5} fill="#4c7cb0" />
                <Rect x={89} y={318} width={18} height={8} rx={4} ry={4} fill="#3b6494" />
                <Rect x={165} y={318} width={18} height={8} rx={4} ry={4} fill="#3b6494" />
            </Svg>

            <Pressable style={styles.dpadUpHit} onPress={onDpadUp} />
            <Pressable style={styles.dpadDownHit} onPress={onDpadDown} />
            <Pressable style={styles.dpadLeftHit} onPress={onDpadLeft} />
            <Pressable style={styles.dpadRightHit} onPress={onDpadRight} />
            <Pressable style={styles.actionAHit} onPress={onActionA} />
            <Pressable style={styles.actionBHit} onPress={onActionB} />

            <View
                style={{
                    position: 'absolute',
                    left: BMO_SCREEN_X,
                    top: BMO_SCREEN_Y,
                    width: BMO_SCREEN_W,
                    height: BMO_SCREEN_H,
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                <View style={styles.eyesRow}>
                    <Animated.View
                        style={[
                            styles.eye,
                            isHappy
                                ? styles.eyeHappy
                                : isThinking
                                    ? styles.eyeThinking
                                    : styles.eyeIdle,
                            eyeAnimStyle,
                        ]}
                    />
                    <Animated.View
                        style={[
                            styles.eye,
                            isHappy
                                ? styles.eyeHappy
                                : isThinking
                                    ? styles.eyeThinking
                                    : styles.eyeIdle,
                            eyeAnimStyle,
                        ]}
                    />
                </View>

                {isIdle ? (
                    <View style={styles.idleMouth} />
                ) : isHappy ? (
                    <View style={styles.happyMouth} />
                ) : isThinking ? (
                    <View style={styles.thinkingMouth} />
                ) : isSurprised ? (
                    <View style={styles.surprisedMouth} />
                ) : isTalking ? (
                    <Animated.View style={[styles.mouthWrap, mouthAnimStyle]}>
                        <View style={styles.mouthOuter}>
                            <View style={styles.mouthTop} />
                            <View style={styles.mouthBottom} />
                        </View>
                    </Animated.View>
                ) : (
                    <View style={styles.idleMouth} />
                )}
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
    eyeIdle: {
        width: BMO_SCREEN_W * 0.08,
        height: BMO_SCREEN_W * 0.08,
        borderRadius: 999,
    },
    eyeHappy: {
        width: BMO_SCREEN_W * 0.13,
        height: BMO_SCREEN_W * 0.08,
        borderTopWidth: 3,
        borderColor: '#1f2f28',
        borderRadius: 999,
        backgroundColor: 'transparent',
    },
    eyeThinking: {
        width: BMO_SCREEN_W * 0.10,
        height: BMO_SCREEN_W * 0.06,
        borderTopWidth: 2.5,
        borderColor: '#1f2f28',
        borderRadius: 999,
        backgroundColor: 'transparent',
    },
    idleMouth: {
        position: 'absolute',
        bottom: BMO_SCREEN_H * 0.27,
        width: BMO_SCREEN_W * 0.22,
        height: BMO_SCREEN_W * 0.10,
        borderBottomWidth: 3,
        borderColor: '#1f2f28',
        borderBottomLeftRadius: 999,
        borderBottomRightRadius: 999,
    },
    happyMouth: {
        position: 'absolute',
        bottom: BMO_SCREEN_H * 0.26,
        width: BMO_SCREEN_W * 0.26,
        height: BMO_SCREEN_W * 0.12,
        borderBottomWidth: 4,
        borderColor: '#1f2f28',
        borderBottomLeftRadius: 999,
        borderBottomRightRadius: 999,
    },
    thinkingMouth: {
        position: 'absolute',
        bottom: BMO_SCREEN_H * 0.27,
        width: BMO_SCREEN_W * 0.20,
        height: BMO_SCREEN_W * 0.02,
        borderRadius: 999,
        backgroundColor: '#1f2f28',
        transform: [{ rotate: '-6deg' }],
    },
    surprisedMouth: {
        position: 'absolute',
        bottom: BMO_SCREEN_H * 0.245,
        width: BMO_SCREEN_W * 0.30,
        height: BMO_SCREEN_W * 0.16,
        borderTopLeftRadius: 999,
        borderTopRightRadius: 999,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        backgroundColor: '#54be95',
        borderWidth: 2,
        borderColor: '#1f2f28',
    },
    mouthWrap: {
        position: 'absolute',
        bottom: BMO_SCREEN_H * 0.26,
        width: BMO_SCREEN_W * 0.36,
        height: BMO_SCREEN_W * 0.20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    mouthOuter: {
        width: '100%',
        height: '100%',
        borderRadius: 999,
        backgroundColor: '#1f2f28',
        borderWidth: 2,
        borderColor: '#0f1b15',
        overflow: 'hidden',
        justifyContent: 'flex-start',
        alignItems: 'center',
    },
    mouthTop: {
        marginTop: 2,
        width: '92%',
        height: '44%',
        borderRadius: 999,
        backgroundColor: '#f5f5ee',
    },
    mouthBottom: {
        marginTop: 1,
        width: '72%',
        height: '36%',
        borderRadius: 999,
        backgroundColor: '#4fbf97',
    },
    dpadUpHit: {
        position: 'absolute',
        left: 76,
        top: 186,
        width: 40,
        height: 40,
        borderRadius: 12,
    },
    dpadDownHit: {
        position: 'absolute',
        left: 76,
        top: 244,
        width: 40,
        height: 40,
        borderRadius: 12,
    },
    dpadLeftHit: {
        position: 'absolute',
        left: 38,
        top: 215,
        width: 40,
        height: 40,
        borderRadius: 12,
    },
    dpadRightHit: {
        position: 'absolute',
        left: 114,
        top: 215,
        width: 40,
        height: 40,
        borderRadius: 12,
    },
    actionAHit: {
        position: 'absolute',
        left: 163,
        top: 232,
        width: 28,
        height: 28,
        borderRadius: 999,
    },
    actionBHit: {
        position: 'absolute',
        left: 187,
        top: 202,
        width: 24,
        height: 24,
        borderRadius: 999,
    },
});

export default BmoFace;
