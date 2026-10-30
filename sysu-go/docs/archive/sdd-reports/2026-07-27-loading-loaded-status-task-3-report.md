Task 3: Add START_LOADING_LOADED_STATUS_TASK_3_REPORT
Task 3: Add START_LOADING, FULLY_LOADED, VERIFY_GUARD handlers in MyTripActivity

Changes made:
- Added import com.google.firebase.Timestamp (already present).
- Added three new when cases in onTripActionClicked (MyTripActivity.kt) before the VIEW_SUMMARY case:
  * START_LOADING: updates tripStatus to "loading" and sets loadingStartedAt timestamp.
  * FULLY_LOADED: updates tripStatus to "fully_loaded", sets fullyLoadedAt, and sets driver's isFull to true.
  * VERIFY_GUARD: navigates to AssignmentActivity for guard verification.
- Used exact code from the brief, preserving this@MyTripActivity in coroutine scopes and toasts.
- No existing handler cases were modified.

All changes are in app/src/main/java/com/sysu/go/activities/MyTripActivity.kt.

This completes Task 3 of the LOADING→LOADED→IN TRANSIT status flow.Fix Round 1
