import { IonCol, IonContent, IonGrid, IonHeader, IonPage, IonRow } from '@ionic/react';
import React, { useEffect, useState } from 'react';
import { RouteComponentProps, useHistory } from 'react-router';
import Frame from '../components/Frame';
import RoomHeader from '../components/RoomHeader';
import VideoPlayer from '../components/VideoPlayer';
import { auth, db, decrement, increment, rtdb, arrayUnion } from '../services/firebase';
import { generateAnonName } from '../services/utilities';
import './Room.css';

const Room: React.FC<RouteComponentProps<{ roomId: string }>> = ({ match }) => {
  const history = useHistory();
  const roomId = match.params.roomId;

  const [validRoom, setValidRoom] = useState(false);
  const [userId, setUserId] = useState('');
  const [ownerId, setOwnerId] = useState('undefined');
  const [loading, setLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);
  const [userList, setUserList] = useState<Map<string, string>>(new Map<string, string>());

  // Verify that the roomId exists in db
  useEffect(() => {
    const fetchRoomAndVid = async () => {
      const roomRef = db.collection('rooms').doc(roomId);
      const room = await roomRef.get();
      if (!room.exists) {
        history.push('/');
      } else {
        setOwnerId(room.data()?.ownerId);
        setValidRoom(true);
      }
    };

    fetchRoomAndVid();
  }, [history, roomId]);

  // Handle logging in
  useEffect(() => {
    if (validRoom) {
      const authUnsubscribe = auth.onAuthStateChanged(async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          const credential = await auth.signInAnonymously();
          await db.collection('users').doc(credential.user?.uid).set({
            name: generateAnonName(),
          });
        }
      });

      return () => {
        authUnsubscribe();
      };
    }
  }, [validRoom]);

  // Subscribe RealTimeDB listeners
  useEffect(() => {
    if (userId !== '' && validRoom) {
      const populateRoom = () => {
        const roomRef = rtdb.ref('/rooms/' + roomId);
        const availableRef = rtdb.ref('/available/');

        // Keep track of online user presence in realtime database rooms
        roomRef.on('value', async (snapshot) => {
          // Populate list of users in a room
          const map: Map<string, string> = new Map<string, string>();
          snapshot.forEach((childSnapshot) => {
            if (childSnapshot.key !== null && childSnapshot.key !== 'userCount') {
              map.set(childSnapshot.key, childSnapshot.child('name').val());
            }
          });
          setUserList(map);

          if (!snapshot.hasChild(userId)) {
            // Keep userId in the room as long as a connection from the client exists
            const username = (await db.collection('users').doc(userId).get()).data()?.name;
            await roomRef.child(userId).set({ name: username });
            await roomRef.update({ userCount: increment });
            await db
              .collection('rooms')
              .doc(roomId)
              .update({
                requests: arrayUnion({ createdAt: Date.now(), senderId: userId, time: 0, type: 'join' }),
              });
          }
        });

        roomRef.child('userCount').on('value', (snapshot) => {
          setUserCount(snapshot.val());
        });

        // Re-add room into /available/ if the room was deleted
        availableRef.on('value', async (snapshot) => {
          if (!snapshot.hasChild(roomId)) {
            await availableRef.child(roomId).set({
              name: 'Room Name',
              createdAt: new Date().toISOString(),
            });
          }
        });

        setLoading(false); // Ready when connections to databases are made

        // Unsubscribe listeners
        return () => {
          roomRef.off('value');
          roomRef.child('userCount').off('value');
          availableRef.off('child_removed');
        };
      };

      const unsub = populateRoom();

      return () => {
        unsub();
      };
    }
  }, [userId, validRoom, roomId]);

  // Handle disconnect events
  useEffect(() => {
    if (!loading && userId !== '' && validRoom) {
      const depopulate = async () => {
        const refUser = rtdb.ref('/rooms/' + roomId + '/' + userId);
        const refRoom = rtdb.ref('/rooms/' + roomId);
        const refAvailable = rtdb.ref('/available/' + roomId);
        const refChat = rtdb.ref('/chats/' + roomId);

        // Always remove user from room on disconnect
        await refRoom.onDisconnect().update({ userCount: decrement });
        await refUser.onDisconnect().remove();

        // Remove the room if the leaving user is the last in the room
        if (userCount <= 1) {
          await refRoom.onDisconnect().remove();
          await refAvailable.onDisconnect().remove();
          await refChat.onDisconnect().remove();
        } else {
          await refRoom.onDisconnect().cancel(); // Cancel all disconnect actions
          await refAvailable.onDisconnect().cancel();
          await refChat.onDisconnect().cancel();
          await refRoom.onDisconnect().update({ userCount: decrement }); // User disconnect still needs to be handled
          await refUser.onDisconnect().remove();
        }
      };

      depopulate();
    }
  }, [userId, validRoom, roomId, loading, userCount]);

  return (
    <IonPage>
      <IonHeader>
        <RoomHeader roomId={roomId} ownerId={ownerId} userId={userId}></RoomHeader>
      </IonHeader>
      {loading ? (
        <IonContent className="ion-padding">Loading...</IonContent>
      ) : (
        <IonGrid class="room-grid">
          <IonRow class="room-row">
            <IonCol size="12" sizeLg="9" class="player-col">
              <VideoPlayer ownerId={ownerId} userId={userId} roomId={roomId}></VideoPlayer>
            </IonCol>
            <IonCol size="12" sizeLg="3" class="frame-col">
              <Frame ownerId={ownerId} roomId={roomId} userId={userId} userList={userList}></Frame>
            </IonCol>
          </IonRow>
        </IonGrid>
      )}
    </IonPage>
  );
};

export default Room;
