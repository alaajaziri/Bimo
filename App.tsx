import React from 'react';
import { StatusBar } from 'react-native';
import BmoChatScreen from './components/BmoChatScreen';

export default function App() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#5BB6A7" />
      <BmoChatScreen />
    </>
  );
}