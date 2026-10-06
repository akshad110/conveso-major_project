"use client";
import { useAITeacher } from "@/hooks/useAITeacher";
import {
  CameraControls,
  Environment,
  Float,
  Gltf,
  Html,
  Loader,
  useGLTF,
} from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Leva, button, useControls } from "leva";
import { Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { degToRad } from "three/src/math/MathUtils";
import { BoardSettings } from "./BoardSettings";
import { EndLesson, LessonGate } from "./LessonGate";
import { MessagesList } from "./MessagesList";
import { Teacher } from "./Teacher";
import { TypingBox } from "./TypingBox";
import { useClassroomSession } from "@/session/useClassroomSession";

/**
 * The courtroom grades with NeutralToneMapping, and matching it is what makes
 * the two rooms look like the same building. It arrived in three r162 and this
 * app is pinned to r161, so fall back rather than silently passing undefined —
 * Linear is the closer of the two survivors; ACESFilmic would crush the dark
 * plum ground to grey.
 */
const TONE_MAPPING = THREE.LinearToneMapping;

const itemPlacement = {
  default: {
    classroom: {
      position: [0.2, -1.7, -2],
    },
    teacher: {
      position: [-1, -1.7, -3],
    },
    board: {
      position: [0.45, 0.382, -6],
    },
  },
  alternative: {
    classroom: {
      position: [0.3, -1.7, -1.5],
      rotation: [0, degToRad(-90), 0],
      scale: 0.4,
    },
    teacher: { position: [-1, -1.7, -3] },
    board: { position: [1.4, 0.84, -8] },
  },
};

export const Experience = () => {
  const teacher = useAITeacher((state) => state.teacher);
  const classroom = useAITeacher((state) => state.classroom);
  const questionsAsked = useAITeacher((state) => state.questionsAsked);

  /**
   * The lesson this room belongs to, if there is one.
   *
   * Called unconditionally and before the gate returns, because it is a hook —
   * and because the handshake it starts has to be in flight while the gate is
   * on screen, not after it comes off. With no `?session=&token=` in the URL
   * `launched` is false, `ready` is true on the first render, and everything
   * below behaves exactly as it did before any of this existed.
   */
  const session = useClassroomSession();

  /*
   * The gate, and the early return that keeps a refused session honest.
   *
   * Returning before the Canvas is the point. A student whose session Converso
   * would not open should be told so, not dropped into a room that looks like a
   * lesson and records nothing — and the room they would be dropped into is two
   * GLBs and a teacher's worth of download for a lesson that cannot be scored.
   */
  if (!session.ready) {
    return (
      <LessonGate
        mode={session.mode}
        refusal={session.refusal}
        canRetry={session.canRetry}
        onRetry={session.retry}
        onReturn={session.returnToLesson}
      />
    );
  }

  return (
    <>
      {/*
        * A hearing ends itself. A conversation with a teacher does not, so a
        * launched lesson gets somewhere to say it is finished — otherwise every
        * lesson ends as an abandonment and nobody ever earns the marks
        * scoreClassroom gives for finishing. Standalone never sees it.
        */}
      {session.launched ? (
        <EndLesson
          onEnd={session.endLesson}
          ending={session.ending}
          questionsAsked={questionsAsked}
        />
      ) : null}

      <div className="nd-layer" style={{ position: "fixed", inset: "auto 16px 16px", zIndex: 10, display: "flex", justifyContent: "center" }}>
        <TypingBox />
      </div>
      <Leva hidden />
      {/* drei's loader is white and centred by default; these props put it in the
          suite's ink and give it the same 2px hairline bar the courtroom uses. */}
      <Loader
        containerStyles={{ background: "var(--ground-deep)" }}
        innerStyles={{ background: "var(--edge)", width: 220, height: 2, borderRadius: 2 }}
        barStyles={{ background: "var(--flame)", height: 2, borderRadius: 2 }}
        dataStyles={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-dim)",
        }}
      />
      <Canvas
        camera={{
          position: [0, 0, 0.0001],
        }}
        // The courtroom grades with NeutralToneMapping; matching it here is what
        // makes the two rooms look like the same building. See TONE_MAPPING above.
        gl={{ toneMapping: TONE_MAPPING, antialias: true }}
        onCreated={({ gl }) => gl.setClearColor("#070610")}
      >
        <CameraManager />

        <Suspense>
          <Float speed={0.5} floatIntensity={0.2} rotationIntensity={0.1}>
            <Html
              transform
              {...itemPlacement[classroom].board}
              distanceFactor={1}
            >
              <MessagesList />
              <BoardSettings />
            </Html>
            <Environment preset="sunset" />
            {/* Neutral fill at the original strength. The pink it replaced tinted
                every face in the room, and --flame is meant to be the only hot
                colour on screen. */}
            <ambientLight intensity={0.8} color="#fff4ec" />

            <Gltf
              src={`/models/classroom_${classroom}.glb`}
              {...itemPlacement[classroom].classroom}
            />
            <Teacher
              teacher={teacher}
              key={teacher}
              {...itemPlacement[classroom].teacher}
              scale={1.5}
              rotation-y={degToRad(20)}
            />
          </Float>
        </Suspense>
      </Canvas>
    </>
  );
};

const CAMERA_POSITIONS = {
  default: [0, 6.123233995736766e-21, 0.0001],
  loading: [
    0.00002621880610890309, 0.00000515037441056466, 0.00009636414192870058,
  ],
  speaking: [0, -1.6481333940859815e-7, 0.00009999846226827279],
};

const CAMERA_ZOOMS = {
  default: 1,
  loading: 1.3,
  speaking: 2.1204819420055387,
};

const CameraManager = () => {
  const controls = useRef();
  const loading = useAITeacher((state) => state.loading);
  const currentMessage = useAITeacher((state) => state.currentMessage);

  useEffect(() => {
    if (loading) {
      controls.current?.setPosition(...CAMERA_POSITIONS.loading, true);
      controls.current?.zoomTo(CAMERA_ZOOMS.loading, true);
    } else if (currentMessage) {
      controls.current?.setPosition(...CAMERA_POSITIONS.speaking, true);
      controls.current?.zoomTo(CAMERA_ZOOMS.speaking, true);
    }
  }, [loading]);

  useControls("Helper", {
    getCameraPosition: button(() => {
      const position = controls.current.getPosition();
      const zoom = controls.current.camera.zoom;
      console.log([...position], zoom);
    }),
  });

  return (
    <CameraControls
      ref={controls}
      minZoom={1}
      maxZoom={3}
      polarRotateSpeed={-0.3} // REVERSE FOR NATURAL EFFECT
      azimuthRotateSpeed={-0.3} // REVERSE FOR NATURAL EFFECT
      mouseButtons={{
        left: 1, //ACTION.ROTATE
        wheel: 16, //ACTION.ZOOM
      }}
      touches={{
        one: 32, //ACTION.TOUCH_ROTATE
        two: 512, //ACTION.TOUCH_ZOOM
      }}
    />
  );
};

useGLTF.preload("/models/classroom_default.glb");
useGLTF.preload("/models/classroom_alternative.glb");
