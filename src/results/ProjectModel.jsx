import React from 'react';
import LiveScene from '../LiveScene.jsx';

// The same actual running project workspace appears in run results.
export default function ProjectModel({ project, run, experiment, measuring, color }) {
  return <LiveScene project={project} run={run} experiment={experiment} measuring={measuring} color={color} />;
}
