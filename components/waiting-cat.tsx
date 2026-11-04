'use client';

import { useEffect, useState } from 'react';

export default function WaitingCat() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 450);
    return () => window.clearTimeout(timer);
  }, []);

  return visible ? <img className="waiting-cat" src="/jumping-gatito.gif" width="64" height="64" alt="" /> : null;
}
