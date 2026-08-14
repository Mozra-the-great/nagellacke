package de.nagellacke.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.AndroidEntryPoint
import de.nagellacke.data.sync.SyncManager
import de.nagellacke.ui.collection.CollectionScreen
import de.nagellacke.ui.diary.DiaryScreen
import de.nagellacke.ui.settings.SettingsScreen
import de.nagellacke.ui.stats.StatsScreen
import de.nagellacke.ui.stickers.StickersScreen
import de.nagellacke.ui.theme.NagellackeTheme
import de.nagellacke.ui.wishlist.WishlistScreen
import javax.inject.Inject

/**
 * Nav labels are kept short on purpose: six items leave about 64dp per column, which is
 * not enough for "Wunschliste" or "Tagebuch" (#240). Each screen still shows its full
 * name in its own top bar, so nothing is actually lost here.
 */
sealed class Screen(
    val route: String,
    /** Full name of the screen — used for the accessibility label, never truncated. */
    val label: String,
    /** What the bottom bar prints; defaults to [label] where that already fits in 64dp. */
    navLabel: String? = null,
) {
    val navLabel: String = navLabel ?: label

    object Collection : Screen("collection", "Lacke")
    object Wishlist   : Screen("wishlist", "Wunschliste", navLabel = "Wünsche")
    object Stickers   : Screen("stickers", "Sticker")
    object Diary      : Screen("diary", "Tagebuch", navLabel = "Buch")
    object Stats      : Screen("stats", "Statistik")
    object Settings   : Screen("settings", "Mehr")
}

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var syncManager: SyncManager

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        syncManager.schedulePeriodicSync()
        setContent { NagellackeTheme { NagellackeApp() } }
    }
}

@Composable
fun NagellackeApp() {
    val nav = rememberNavController()
    val tabs = listOf(Screen.Collection, Screen.Wishlist, Screen.Stickers, Screen.Diary, Screen.Stats, Screen.Settings)
    val icons = listOf(Icons.Default.Collections, Icons.Default.ShoppingCart, Icons.Default.Star, Icons.Default.AutoStories, Icons.Default.BarChart, Icons.Default.Settings)

    Scaffold(
        bottomBar = {
            val navBackStack by nav.currentBackStackEntryAsState()
            val current = navBackStack?.destination
            NavigationBar {
                tabs.forEachIndexed { idx, screen ->
                    NavigationBarItem(
                        selected = current?.hierarchy?.any { it.route == screen.route } == true,
                        onClick = {
                            nav.navigate(screen.route) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(icons[idx], contentDescription = screen.label) },
                        // Six tabs across 1080px at density 450 leave about 64dp each. The
                        // labels below are cut to fit that at labelSmall; maxLines then keeps
                        // the failure mode an ellipsis rather than the mid-word break this
                        // started as (#240) when the system font scale is turned up.
                        //
                        // alwaysShowLabel = false was the obvious alternative and does not
                        // work here: the selected item is not granted extra width on this
                        // layout, so "Tagebuch" stayed truncated while the other five lost
                        // their labels for nothing.
                        label = {
                            Text(
                                screen.navLabel,
                                style = MaterialTheme.typography.labelSmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(nav, startDestination = Screen.Collection.route, Modifier.padding(innerPadding)) {
            composable(Screen.Collection.route) { CollectionScreen() }
            composable(Screen.Wishlist.route)   { WishlistScreen() }
            composable(Screen.Stickers.route)   { StickersScreen() }
            composable(Screen.Diary.route)      { DiaryScreen() }
            composable(Screen.Stats.route)      { StatsScreen() }
            composable(Screen.Settings.route)   { SettingsScreen() }
        }
    }
}
